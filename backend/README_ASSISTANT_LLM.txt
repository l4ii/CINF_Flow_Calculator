CINF Assistant — LLM / inference setup (operations)
==================================================

Inference is **embedded llama.cpp only** (fully offline for packaged desktop installs).
Uses the Python binding `llama-cpp-python` and a local `.gguf` file in-process.
No external inference daemon and no network for inference once the model binary is on disk.

Python binding install (especially Windows)
-------------------------------------------
Plain `pip install llama-cpp-python` may try to compile from source and fail if MSVC /
CMake / NMake are not installed. Prefer **pre-built wheels**:

    pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

CUDA builds use other indexes documented upstream (`abetlen/llama-cpp-python`).
Ensure the same Python interpreter that runs `backend/app.py` is the one where you install the wheel.

Model file (GGUF)
-----------------
Default path (first match wins):
    backend/models/assistant.gguf   (relative to the directory containing assistant_api.py)

Search also checks cwd-based paths, CINF_RESOURCE_ROOT/models/, and PyInstaller executable
parent /models/ — see `_default_gguf_search_paths` / `_models_dir_candidates` in assistant_api.py.

Fallback: if `assistant.gguf` is not found, but a `models/` directory contains **exactly one**
`*.gguf` file (non-recursive listing), that file is used. If multiple `.gguf` files exist, set an
explicit path:

CINF_LLAMACPP_GGUF
    Absolute or ~-expanded path to the `.gguf` file.

CINF_RESOURCE_ROOT（可选）
    若运行时 `assistant_api.py` 的运行目录不是源码里的 backend（例：PyInstaller/Electron），
    可把「资源根目录」指到内含 `models/assistant.gguf` 的目录。

CINF_LLAMACPP_N_CTX
    Context length (default 4096). Larger values use more RAM.

CINF_LLAMACPP_N_GPU_LAYERS
    Offload layers to GPU (default 0 = CPU only; good for portable/offline builds).

CINF_LLAMACPP_TEMPERATURE
    Sampling temperature (default 0.35).

CINF_LLAMACPP_MAX_TOKENS
    Maximum new tokens per reply (default 2048, capped internally).

CINF_LLAMACPP_REPEAT_PENALTY
    Penalize repeating tokens (default 1.18). Too low may cause the model to loop one sentence;
    too high can make answers stiff. Range ~1.05–1.3 is typical.

CINF_LLAMACPP_FREQUENCY_PENALTY / CINF_LLAMACPP_TOP_P / CINF_LLAMACPP_TOP_K
    Optional sampling tuning (defaults: 0.08, 0.9, 40).

CINF_LLAMACPP_STOP
    Comma-separated extra stop strings, or "-" to rely only on the chat handler defaults.
    Default merges Qwen ChatML end-of-turn markers with <|endoftext|> (see `_llamacpp_stop_sequences`).

CINF_LLAMACPP_CHAT_FORMAT
    Leave empty / "auto" for GGUF/libr defaults. Set "qwen" if replies look wrongly formatted or loop
    under your GGUF revision.

Python dependency: install `llama-cpp-python` (see project requirements.txt). On Windows use
official wheels matching your Python version; CUDA/CLBLAST builds require the matching extras
from upstream docs.

Knowledge directory
-------------------
CINF_ASSISTANT_KNOWLEDGE_DIR
    Optional absolute or user-expanded path. If unset, the backend uses `assistant_knowledge/`
    next to assistant_api.py.

Under that directory, all `*.md` and `*.txt` files are loaded **recursively** (subfolders included).
Paths containing a segment whose name starts with `.` (e.g. `.git`) are skipped. Files are merged
in relative-path sort order up to an internal size cap (_MAX_KNOWLEDGE_CHARS in assistant_api.py).

HTTP endpoints (Flask app mounts these)
---------------------------------------
GET  /api/assistant/status
    Returns inferenceBackend (always "llamacpp"), inferenceReady, ggufPath, importOk, knowledgeDir,
    knowledgeLoadedChars, and optional error/initError fields.

POST /api/assistant/chat
    JSON body: locale, messages, optional snapshot, optional stream=true.
    Non-stream: JSON with message text. Stream: newline-delimited JSON with { "content": "..." } chunks.

Packaging for offline distribution
---------------------------------
- Include the chosen `.gguf` next to the backend (e.g. PyInstaller: collect into
  backend/models/assistant.gguf) or ship a second archive and point CINF_LLAMACPP_GGUF at install time.
- Ensure `llama-cpp-python` native DLLs/libs are bundled for the target ABI (often automatic when
  the dependency wheel is bundled with PyInstaller).

Firewall / networking
----------------------
The frontend must reach your Flask backend. The backend does not need outbound internet for inference.


--- Architecture / FAQ（中英对照，与代码一致）---

Chinese overview（概述）
-----------------------
前端右下角助手挂件（AssistantPanel）发送每条用户消息时的分支顺序为：
 ① **规则/FAQ（非 AI）**：`tryRuleBasedAssistantReply` 在前端用关键词与目录匹配机构介绍、侧栏导航、导出 Word、设置主题、后端连接提示、公式名定位、最近一次计算字面摘要等；命中则直接追加气泡，**不调后端**。
 ② **LLM 不可用**：若 `/api/assistant/status` 给出的 `inferenceReady` 为假，则返回本地固定话术 `smartInterpretationNotReadyReply`，**不调 chat**。
 ③ **LLM（AI）**：否则 POST `/api/assistant/chat`，流式 NDJSON；服务端把免责声明、导航规则、`snapshot` JSON、以及知识库全文片段一并写入 **system** 消息，再拼接用户对话历史。

后端挂载：`register_assistant_routes(app)`（见 `backend/app.py`），路由实现在 `assistant_api.py`。

智能解读 / 知识库是否「训练」进模型？
--------------------------------------
**否。** 知识库文件仅在每次请求前由 `load_knowledge_snippet()` 读取并拼入 **system prompt**（上下文注入，体量上限约 14k 字符）。模型权重不会因放置 `.md`/`.txt` 而自动微调；若无可用 GGUF 或依赖未就绪，助手仍可走规则 FAQ，只是没有长文生成。

知识库目录（可投放文件）
------------------------
- 默认：`backend/assistant_knowledge/`（与 `assistant_api.py` 同级的固定相对路径）。
- 覆盖：环境变量 `CINF_ASSISTANT_KNOWLEDGE_DIR` 指向任意可读目录。
- 扫描规则：**递归**子文件夹；后缀 `.md` / `.txt`；路径中含 `.` 开头目录名（如 `.git`）或隐藏文件跳过；按相对路径排序合并。

English mirror（short）
-----------------------
1) **Non‑AI path**: rule/FAQ matching in the browser (`tryRuleBasedAssistantReply`) handles fixed copy and simple lookups—no HTTP chat call.
2) **AI path**: when `inferenceReady` is true, the UI posts to `/api/assistant/chat`; the backend injects knowledge text + UI snapshot into the **system** message (runtime context, not model training/fine‑tuning).
3) **Knowledge dir**: recursive `.md`/`.txt` under `assistant_knowledge/` or `CINF_ASSISTANT_KNOWLEDGE_DIR`; hidden path segments skipped.
