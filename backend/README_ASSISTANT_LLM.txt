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

Electron / NSIS packaged installs (other PCs)
---------------------------------------------
Build variants（安装包文件名与目录）：
- `npm run dist:win:ai`      → `release-qwen/`，文件名含后缀 `_Qwen`（内含本地 GGUF/Qwen）
- `npm run dist:win:noai`    → `release/`，无 `_Qwen`/`NoAI` 等后缀（无本地 GGUF）
- `npm run dist:win7:ai`     → `release-win7-qwen/`，`-Win7_Qwen`
- `npm run dist:win7:noai`   → `release-win7/`，仍为 `-Win7`（与老 Win 兼容管线一致）
- `npm run dist:win:all4` 或 `npm run dist:all4` → 依次打上述四套，四套目录互不覆盖

No-AI 变体在构建时设置 `CINF_PACK_LOCAL_AI=0`、跳过 GGUF 打入，并通过 `electron-builder.win.no-ai.yml` /
`electron-builder.win7.no-ai.yml` 的 `extraMetadata` 标记 `cinfAssistantLocalDeploy=false`。

1. Before AI packaging (`npm run dist:win:ai` / `npm run dist:win7:ai`), place the GGUF at `backend/models/assistant.gguf`,
   or set env `CINF_ASSISTANT_GGUF` to the full path of the `.gguf` file on the build machine.
2. AI release scripts run `scripts/stage-pack-resources.js`, which copies that file into
   `build/pack-resources/...` so electron-builder includes it (otherwise `*.gguf` may be gitignored
   and omitted from `extraResources`).
3. `npm run dist:win` (AI default alias) runs **`npm run build:python` first**, producing `backend/dist/backend.exe`
   with PyInstaller (`build_backend.py` uses `--collect-all=llama_cpp`). **`npm run dist:win:full`**
   is an alias for the same command. Electron injects `CINF_RESOURCE_ROOT` → `resources/backend`
   so GGUF under `resources/backend/models/` is found at runtime.
4. Windows: if the install path contains CJK / non‑ASCII characters, older llama native code may fail to
   open the GGUF file. The backend passes an **8.3 short path** to the loader when possible; if it still
   fails, install the app under a path that only uses ASCII (e.g. `D:\Apps\...`).
5. The packaged `resources/backend` directory **does not ship `*.py` sources**—only `backend.exe`,
   knowledge text, and model files. Win7 legacy builds also run `build:python` before packaging so
   `backend.exe` is present; embedded `python38` is a fallback only.
6. Avoid listing `backend/**` under electron-builder `files` (asar) while also copying backend via
   `extraResources`: that duplicates `backend/dist/backend.exe` (~hundreds of MB) and inflates the
   installer. This repo keeps backend **only** under `extraResources` → `resources/backend`.
7. With `CINF_LLAMACPP_N_GPU_LAYERS` unset or `0` (CPU only), the backend passes `offload_kqv=False` and
   `flash_attn=False` to `Llama(...)` so context setup does not enable GPU KQV offload defaults.
8. **Electron 启动后端可执行文件的顺序**（`electron/main.js`）：优先
   `resources/backend/dist/backend/backend.exe`（PyInstaller **onedir**），其次
   `resources/backend/dist/backend.exe`（**onefile**）。若两种产物同时存在，旧版曾错误地永远选用 onefile，
   导致你以为「已改为 onedir」但日志里仍是 `Temp\_MEI*`。切换打包方式后请删除另一种产物或先执行 `node scripts/clean.js` 再打包。

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

CINF_LLAMACPP_USE_MMAP
    是否用内存映射加载 GGUF（默认：Linux/macOS 为 true；Windows 为 false）。
    在部分 Windows 环境下 `mmap` 可能在原生层触发 access violation；若需显式开启可设 `1`。
    对应 llama-cpp-python 的 `Llama(..., use_mmap=...)`。

CINF_LLAMACPP_USE_MLOCK
    是否 mlock 模型页（默认 false）。设为 `1` 会尽量把模型锁在物理内存。

CINF_LLAMACPP_VERBOSE
    设为 `1` 时 Llama(..., verbose=True)：加载过程向 stderr 输出 llama.cpp 详情（打包环境可在控制台或服务日志中看到）。

CINF_LLAMACPP_N_THREADS / CINF_LLAMACPP_N_THREADS_BATCH
    可选正整数：覆盖 Llama 的 n_threads / n_threads_batch（未设置则沿用 llama-cpp-python 默认）。
    排障时可试 `N_THREADS=1` 规避个别环境下的线程/native 交互问题。

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

CINF_LLAMACPP_NATIVE_PROBE
    Whether `/api/assistant/status` should call `llama_backend_init` + `llama_print_system_info` for
    low-level diagnostics. `1` enables, `0` disables.
    Default: **disabled in Windows frozen/package builds**, enabled elsewhere.
    Reason: a few customer machines can throw `access violation` during probe even before model load.

CINF_ASSISTANT_LOCAL_DEPLOYMENT
    `1` enables local AI inference route; `0` forces no-AI runtime behavior (status/chat returns
    "contact development team for local AI deployment").

Troubleshooting: access violation while loading GGUF
----------------------------------------------------
If Windows already defaults `CINF_LLAMACPP_USE_MMAP` off and chat still fails with
`access violation reading 0x...` inside native code:

- If **`llamaNativeProbeStage` is `llama_backend_init`**, the crash happens **before** loading weights:
  often **OpenMP / BLAS vs ggml** interaction or GPU-backend probing. The backend sets conservative
  thread env vars **before** importing Flask/numpy (`backend/win_llama_runtime_env.py` from `app.py`).
  Retry after a clean rebuild; on the client, exclude the install folder from aggressive AV real-time scan.
  **Works on developer PC but not customer:** dev machines usually already have **Microsoft Visual C++
  Redistributable 2015–2022 (x64)** (and VS toolchain DLL side-effects); thin client images often miss it—
  install the official VC++ runtime before concluding the GGUF/wheel is bad. Corporate **EDR/antivirus**
  hooks on DLL loads produce the same `access violation`.
- Call **GET /api/assistant/status** and read **`llamaNativeBuildInfo`**. If it mentions GGML_AVX2 (or
  similar) while the **target CPU lacks that instruction set**, install a legacy / no‑AVX
  `llama-cpp-python` wheel matching the build Python, then rebuild `backend.exe` (see abetlen indexes).
- Confirm the **GGUF matches** the llama.cpp revision inside the bundled binding; try another quant or
  re-export with a compatible toolchain.
- Set **`CINF_LLAMACPP_VERBOSE=1`** once and reproduce; check console/stderr for native logs before crash.
- Optionally set **`CINF_LLAMACPP_N_THREADS=1`** to rule out threading edge cases.

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
    knowledgeLoadedChars, optional error/initError fields, and when importOk: llamaCppPythonVersion,
    llamaCppModulePath, llamaNativeBuildInfo (ggml/AVX feature string from llama.cpp; useful if chat
    crashes with access violation on load), llamaNativeBuildInfoError (why native build info is empty),
    llamaNativeProbeStage (failed stage: import / backend_init / print_system_info / disabled),
    llamaNativeProbeEnabled (whether the native probe is currently active),
    runtimePlatform (python/arch/machine quick diagnostics), and llamaRuntimeLibDiag (LLAMA_CPP_LIB_PATH,
    extracted lib dir *.dll list, and possible llama/ggml *.dll under _MEIPASS root for conflict checks).
    For PowerShell text output convenience, `llamaRuntimeLibDiagSummary` also returns CSV strings.

Debug build mode toggle
-----------------------
`build_backend.py` supports `CINF_PYINSTALLER_MODE=onedir` for A/B testing onefile extraction issues.
From repo root on Windows:
    npm run build:python:onedir
Default remains onefile (`npm run build:python`).

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

嵌入式推理「访问冲突 / access violation」排障
----------------------------------------
- `inferenceReady=true` 只表示 **llama_cpp 可导入且解析到 GGUF**；**首次 chat** 才会构造 `Llama()` 读权重，崩溃多发生在此步。
- 请 **GET `/api/assistant/status`**：查看 `llamaNativeBuildInfo`、`llamaCppPythonVersion`、`llamaCppModulePath`。若构建信息含 **AVX2** 等而目标 CPU 不支持，需换 **兼容指令集的 llama-cpp-python wheel** 并重打包 `backend.exe`。
- 若仅客户机报 `llamaNativeProbeStage=llama_backend_init` 访问冲突，而开发机正常：常见是 **未装 VC++ 运行库（2015–2022 x64）** 或 **杀毒/EDR 拦截原生 DLL**；开发机因装有 Visual Studio / 完整运行库往往「看不出来」。
- 状态中的 `cinfResourceRootEnv` 应为安装目录下的 `resources/backend`；`ggufBackendDir` 应与其一致（或由该路径解析出知识库）。GGUF 可同时由 `cinfLlamaCppGgufEnv` 显式指定。
- 可设 **`CINF_LLAMACPP_VERBOSE=1`**、`CINF_LLAMACPP_N_THREADS=1` 辅助定位；细节见上文英文 **Troubleshooting** 小节。

English mirror（short）
-----------------------
1) **Non‑AI path**: rule/FAQ matching in the browser (`tryRuleBasedAssistantReply`) handles fixed copy and simple lookups—no HTTP chat call.
2) **AI path**: when `inferenceReady` is true, the UI posts to `/api/assistant/chat`; the backend injects knowledge text + UI snapshot into the **system** message (runtime context, not model training/fine‑tuning).
3) **Knowledge dir**: recursive `.md`/`.txt` under `assistant_knowledge/` or `CINF_ASSISTANT_KNOWLEDGE_DIR`; hidden path segments skipped.
