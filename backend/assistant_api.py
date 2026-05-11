"""智能助手后端：加载知识片段；进程内 llama.cpp（GGUF）推理，流式或非流式 NDJSON/json 与前端保持一致。"""
from __future__ import annotations

import importlib
import json
import os
import sys
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List

from flask import Response, jsonify, request, stream_with_context

_BACKEND_DIR = Path(__file__).resolve().parent
_DEFAULT_KNOWLEDGE_REL = Path("assistant_knowledge")
_DEFAULT_GGUF_REL = Path("models") / "assistant.gguf"

_MAX_KNOWLEDGE_CHARS = 14_000
_MAX_SNAPSHOT_JSON = 12_000

_llama_lock = threading.Lock()
_llama_instance: Any = None
_llama_init_error: str | None = None

_DISCLAIMER_ZH = (
    "你是 CINF 浆体/管道水力类计算工具的助手。答复仅为工程交流与软件使用说明，"
    "不构成设计担保或规范的替代；重大事项须由工程师结合标准与现场判定。"
)

_DISCLAIMER_EN = (
    "You assist users of this slurry pipeline hydraulics calculator. Answers are informal guidance "
    "and software help only—not a substitute for standards, codes, or professional engineering judgment."
)

_VC_RATIO_HINT_ZH = (
    "临界流速锁定对比动画（velocity_ratio=new_Vc/locked_Vc）："
    "新算得 Vc 相对锁定值越大，通常表示需更高运行流速才达临界，沉积风险往往越高；"
    "Vc 明显低于锁定值则更易悬浮。档位含 settle-*、still-flow、medium-flow、fast-flow 等，与后端 classify_locked_vc_animation 一致。"
)


def _knowledge_dir() -> Path:
    raw = os.environ.get("CINF_ASSISTANT_KNOWLEDGE_DIR", "").strip()
    if raw:
        return Path(raw).expanduser()
    return _BACKEND_DIR / _DEFAULT_KNOWLEDGE_REL


def _explicit_gguf_env() -> bool:
    return bool(os.environ.get("CINF_LLAMACPP_GGUF", "").strip())


def _models_dir_candidates() -> List[Path]:
    """用于 assistant.gguf 与「唯一 *.gguf」回退的 models 目录列表（顺序即搜索顺序）。"""
    candidates: List[Path] = []

    def _add(p: Path) -> None:
        try:
            candidates.append(p.resolve())
        except OSError:
            candidates.append(p)

    _add(_BACKEND_DIR / "models")
    _add(Path.cwd() / "models")
    _add(Path.cwd() / "backend" / "models")
    rr = os.environ.get("CINF_RESOURCE_ROOT", "").strip()
    if rr:
        _add(Path(rr).expanduser() / "models")
    if getattr(sys, "frozen", False):
        _add(Path(sys.executable).resolve().parent / "models")

    seen: set[Path] = set()
    out: List[Path] = []
    for p in candidates:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _default_gguf_search_paths() -> List[Path]:
    """开发与打包并存：__file__ 可能在临时目录或 cwd 与 backend 源码目录不一致。"""
    candidates: List[Path] = []

    def _add(p: Path) -> None:
        try:
            candidates.append(p.resolve())
        except OSError:
            candidates.append(p)

    _add(_BACKEND_DIR / _DEFAULT_GGUF_REL)
    _add(Path.cwd() / "models" / "assistant.gguf")
    _add(Path.cwd() / "backend" / "models" / "assistant.gguf")

    rr = os.environ.get("CINF_RESOURCE_ROOT", "").strip()
    if rr:
        _add(Path(rr).expanduser() / "models" / "assistant.gguf")

    if getattr(sys, "frozen", False):
        _add(Path(sys.executable).resolve().parent / "models" / "assistant.gguf")

    seen: set[Path] = set()
    out: List[Path] = []
    for p in candidates:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _unique_gguf_in_dir(models_dir: Path) -> Path | None:
    """若目录内仅有一个 *.gguf（非递归），返回该文件；否则返回 None。"""
    if not models_dir.is_dir():
        return None
    files = sorted(
        [
            p
            for p in models_dir.iterdir()
            if p.is_file() and not p.name.startswith(".") and p.suffix.lower() == ".gguf"
        ],
        key=lambda p: p.name.lower(),
    )
    if len(files) == 1:
        return files[0]
    return None


def _first_existing_default_gguf() -> Path | None:
    for p in _default_gguf_search_paths():
        if p.is_file():
            return p
    tried_models: set[Path] = set()
    for models_dir in _models_dir_candidates():
        if models_dir in tried_models:
            continue
        tried_models.add(models_dir)
        fallback = _unique_gguf_in_dir(models_dir)
        if fallback is not None:
            return fallback
    return None


def _resolve_gguf_path() -> Path | None:
    raw = os.environ.get("CINF_LLAMACPP_GGUF", "").strip()
    if raw:
        p = Path(raw).expanduser().resolve()
        return p if p.is_file() else None
    return _first_existing_default_gguf()


def _llamacpp_n_ctx() -> int:
    try:
        v = int(os.environ.get("CINF_LLAMACPP_N_CTX", "4096"))
        return max(512, min(v, 131072))
    except ValueError:
        return 4096


def _llamacpp_n_gpu_layers() -> int:
    try:
        return int(os.environ.get("CINF_LLAMACPP_N_GPU_LAYERS", "0"))
    except ValueError:
        return 0


def _llamacpp_temperature() -> float:
    try:
        return float(os.environ.get("CINF_LLAMACPP_TEMPERATURE", "0.35"))
    except ValueError:
        return 0.35


def _llamacpp_max_tokens() -> int:
    try:
        v = int(os.environ.get("CINF_LLAMACPP_MAX_TOKENS", "2048"))
        return max(64, min(v, 8192))
    except ValueError:
        return 2048


def _llamacpp_top_p() -> float:
    try:
        return float(os.environ.get("CINF_LLAMACPP_TOP_P", "0.9"))
    except ValueError:
        return 0.9


def _llamacpp_top_k() -> int:
    try:
        v = int(os.environ.get("CINF_LLAMACPP_TOP_K", "40"))
        return max(1, min(v, 100000))
    except ValueError:
        return 40


def _llamacpp_repeat_penalty() -> float:
    """>1 抑制循环复读；过小易复读，过大易跑题。"""
    try:
        v = float(os.environ.get("CINF_LLAMACPP_REPEAT_PENALTY", "1.18"))
        return max(1.0, min(v, 2.0))
    except ValueError:
        return 1.18


def _llamacpp_frequency_penalty() -> float:
    try:
        return float(os.environ.get("CINF_LLAMACPP_FREQUENCY_PENALTY", "0.08"))
    except ValueError:
        return 0.08


def _llamacpp_stop_sequences() -> List[str]:
    """与常见 Qwen/ChatML 句末分隔符对齐，避免生成在轮次结束前空转复读。"""
    raw = os.environ.get("CINF_LLAMACPP_STOP", "").strip()
    if raw == "-" or raw.lower() == "none":
        return []
    if raw:
        return [s.strip().replace("\\n", "\n") for s in raw.split(",") if s.strip()]
    return ["<|im_end|>", "<|endoftext|>"]


def _llamacpp_chat_format_kw() -> Dict[str, Any]:
    """设 CINF_LLAMACPP_CHAT_FORMAT=qwen（或 chatml）可强行指定；auto/空则交由 GGUF/libr默认值。"""
    raw = os.environ.get("CINF_LLAMACPP_CHAT_FORMAT", "").strip().lower()
    if not raw or raw in ("auto", "default"):
        return {}
    return {"chat_format": raw}


def _llamacpp_completion_kwargs(
    *,
    stream: bool,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "stream": stream,
        "temperature": _llamacpp_temperature(),
        "max_tokens": _llamacpp_max_tokens(),
        "top_p": _llamacpp_top_p(),
        "top_k": _llamacpp_top_k(),
        "repeat_penalty": _llamacpp_repeat_penalty(),
        "frequency_penalty": _llamacpp_frequency_penalty(),
    }
    stops = _llamacpp_stop_sequences()
    if stops:
        out["stop"] = stops
    return out


def _try_import_llamacpp() -> bool:
    try:
        importlib.import_module("llama_cpp")
        return True
    except ImportError:
        return False


def _get_llama():
    global _llama_instance, _llama_init_error
    if _llama_init_error is not None:
        raise RuntimeError(_llama_init_error)
    if _llama_instance is not None:
        return _llama_instance
    path = _resolve_gguf_path()
    if path is None:
        exp = os.environ.get("CINF_LLAMACPP_GGUF", "").strip()
        hint = (
            f"未找到 GGUF：已配置 CINF_LLAMACPP_GGUF={exp!r} 但路径不可用；"
            f"或未放置默认模型文件 {_DEFAULT_GGUF_REL}（相对于 backend 目录），"
            f"或在某一 models 目录内仅放置一个 .gguf 文件。"
        )
        raise RuntimeError(hint)
    try:
        Llama = importlib.import_module("llama_cpp").Llama
    except ImportError as e:
        _llama_init_error = (
            "未安装 llama-cpp-python（完全离线嵌入式推理所需）。构建环境请 pip install llama-cpp-python。"
        )
        raise RuntimeError(_llama_init_error) from e
    try:
        ctor_kw: Dict[str, Any] = dict(
            model_path=str(path),
            n_ctx=_llamacpp_n_ctx(),
            n_gpu_layers=_llamacpp_n_gpu_layers(),
            verbose=False,
        )
        ctor_kw.update(_llamacpp_chat_format_kw())
        _llama_instance = Llama(**ctor_kw)
    except Exception as e:
        raise RuntimeError(f"加载 GGUF 失败: {e}") from e
    return _llama_instance


def _knowledge_path_skipped(p: Path, root: Path) -> bool:
    try:
        rel = p.relative_to(root)
    except ValueError:
        return True
    return any(part.startswith(".") for part in rel.parts)


def load_knowledge_snippet() -> str:
    """递归读取知识目录下 *.md / *.txt，按相对路径排序合并；跳过隐藏路径段与隐藏文件。"""
    d = _knowledge_dir()
    if not d.is_dir():
        return ""
    paths: List[Path] = []
    for pattern in ("*.md", "*.txt"):
        for p in d.rglob(pattern):
            if not p.is_file() or _knowledge_path_skipped(p, d):
                continue
            paths.append(p)
    paths = sorted({p.resolve() for p in paths}, key=lambda p: str(p.relative_to(d)).lower())
    chunks: List[str] = []
    total = 0
    for p in paths:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        try:
            rel = p.relative_to(d)
            label = str(rel).replace("\\", "/")
        except ValueError:
            label = p.name
        block = f"--- 文件 {label} ---\n{text.strip()}\n"
        if total + len(block) > _MAX_KNOWLEDGE_CHARS:
            remain = _MAX_KNOWLEDGE_CHARS - total
            if remain > 80:
                block = block[:remain] + "\n…(truncated)\n"
            else:
                break
        chunks.append(block)
        total += len(block)
        if total >= _MAX_KNOWLEDGE_CHARS:
            break
    return "\n".join(chunks)


def check_llamacpp_status() -> Dict[str, Any]:
    import_ok = _try_import_llamacpp()
    path = _resolve_gguf_path()
    file_ok = path is not None
    err: str | None = None
    if not import_ok:
        err = "llama-cpp-python 未安装或无法导入"
    elif not file_ok:
        if _explicit_gguf_env():
            err = "CINF_LLAMACPP_GGUF 指向的文件不存在"
        else:
            err = (
                f"未找到嵌入式模型：请将 GGUF 置于 {_DEFAULT_GGUF_REL}（相对于 backend）、"
                f"或在某一 models 目录内仅放一个 .gguf，或设置 CINF_LLAMACPP_GGUF。"
            )
    ready = import_ok and file_ok
    return {
        "configuredModel": path.name if path else "",
        "modelPresent": file_ok,
        "models": [path.name] if path else [],
        "error": err,
        "ggufPath": str(path) if path else "",
        "importOk": import_ok,
        "initError": _llama_init_error,
        "inferenceReady": ready,
        "ggufBackendDir": str(_BACKEND_DIR),
        "ggufSearchTried": [str(p) for p in _default_gguf_search_paths()],
    }


def _build_system(locale: str, snapshot: Any, knowledge_text: str) -> str:
    if locale == "en":
        disclaimer = _DISCLAIMER_EN
        nav_rule = (
            "If you want the UI to switch to a specific formula tab, append exactly one line at the END of your reply: "
            "`[[ACTION:NAVIGATE:formula_id]]` where formula_id MUST be one id from the allowed list in context. "
            "Do not invent ids."
        )
    else:
        disclaimer = _DISCLAIMER_ZH
        nav_rule = (
            "若需要帮用户切换到某一公式页，在回复末尾单独一行输出："
            "`[[ACTION:NAVIGATE:公式id]]`，其中公式 id 必须来自上下文中允许的 id 列表；不得编造。"
        )

    snap_s = ""
    try:
        snap_s = json.dumps(snapshot, ensure_ascii=False, indent=0)
    except (TypeError, ValueError):
        snap_s = str(snapshot)
    if len(snap_s) > _MAX_SNAPSHOT_JSON:
        snap_s = snap_s[:_MAX_SNAPSHOT_JSON] + "\n…(truncated)"

    parts = [
        disclaimer,
        nav_rule,
        _VC_RATIO_HINT_ZH if locale != "en" else _VC_RATIO_HINT_ZH + " / See animation_type velocity_ratio.",
        "--- 侧边栏分组（软件功能检索） ---",
        "临界流速计算、清水摩阻损失、浆体摩阻损失、压力与扬程、浆体加速流、浆体消能。",
        "--- 客户端上下文 snapshot (JSON) ---",
        snap_s,
    ]
    if knowledge_text:
        parts.extend(["--- 附加知识库 ---", knowledge_text.strip()])
    return "\n\n".join(parts)


def _normalize_messages(history: Any) -> List[Dict[str, str]]:
    if not isinstance(history, list):
        return []
    out: List[Dict[str, str]] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or content is None:
            continue
        text = str(content).strip()
        if not text:
            continue
        out.append({"role": role, "content": text})
    return out[-40:]


def register_assistant_routes(app) -> None:
    @app.route("/api/assistant/status", methods=["GET"])
    def assistant_status():
        kb = load_knowledge_snippet()
        lm = check_llamacpp_status()
        base: Dict[str, Any] = {
            "inferenceBackend": "llamacpp",
            "knowledgeDir": str(_knowledge_dir()),
            "knowledgeLoadedChars": len(kb),
        }
        base.update(lm)
        return jsonify(base)

    @app.route("/api/assistant/chat", methods=["POST"])
    def assistant_chat():
        data = request.get_json(silent=True) or {}
        locale = data.get("locale") or "zh"
        if locale not in ("zh", "en"):
            locale = "zh"
        snapshot = data.get("snapshot")
        messages = _normalize_messages(data.get("messages"))
        if not messages:
            return jsonify({"success": False, "error": "messages required"}), 400

        stream = bool(data.get("stream"))
        knowledge_text = load_knowledge_snippet()
        system_content = _build_system(locale, snapshot, knowledge_text)
        chat_messages: List[Dict[str, str]] = [{"role": "system", "content": system_content}, *messages]

        return _llamacpp_chat_response(chat_messages, stream)


def _llamacpp_chat_response(chat_messages: List[Dict[str, str]], stream: bool) -> Any:
    if stream:

        def generate() -> Iterable[str]:
            try:
                with _llama_lock:
                    llm = _get_llama()
                    kw = _llamacpp_completion_kwargs(stream=True)
                    sc = llm.create_chat_completion(messages=chat_messages, **kw)
                    for chunk in sc:
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        c = delta.get("content") or ""
                        if c:
                            yield json.dumps({"content": str(c)}, ensure_ascii=False) + "\n"
            except Exception as ex:
                yield json.dumps({"error": str(ex)}, ensure_ascii=False) + "\n"

        return Response(
            stream_with_context(generate()),
            mimetype="application/x-ndjson",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        with _llama_lock:
            llm = _get_llama()
            kw = _llamacpp_completion_kwargs(stream=False)
            out = llm.create_chat_completion(messages=chat_messages, **kw)
    except Exception as e:
        return (
            jsonify(
                {
                    "success": False,
                    "error": str(e),
                    "hint": "嵌入式推理失败：检查 CINF_LLAMACPP_GGUF、GGUF 是否与当前 llama.cpp 构建匹配，或查阅 backend/README_ASSISTANT_LLM.txt。",
                    "inferenceBackend": "llamacpp",
                }
            ),
            503,
        )

    content = ""
    try:
        choices = out.get("choices") or []
        if choices:
            msg = choices[0].get("message") or {}
            content = str(msg.get("content") or "")
    except (TypeError, AttributeError, KeyError):
        content = ""

    path = _resolve_gguf_path()
    return jsonify(
        {
            "success": True,
            "message": content,
            "model": path.name if path else "",
            "inferenceBackend": "llamacpp",
            "raw": out,
        }
    )
