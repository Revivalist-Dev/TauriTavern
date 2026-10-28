# Tools

A tool turns a model request into one operation with a result. The model reads a tool description and issues a call; the runtime checks the Invocation's tool set, performs the operation, and sends the result back into the next round's context.

## Identity and call names

The tool catalog uses stable `ToolId`s. A built-in tool is `builtin:<name>`, an MCP tool is `mcp/<registration-id>:<name>`, and an extension tool is `extension/<extensionId>:<name>`. Profile tool configuration and run records use these IDs.

The model-facing call name is generated when the Invocation is created, and the tool snapshot keeps its mapping to the stable ID. Built-in tools such as `workspace_read_file` keep a fixed name; extension tools use the registered `name`, MCP tools use the server and tool names, characters and length are normalized for the model protocol, and a collision adds a short suffix such as `__2`.

Text written for the model — tool descriptions, argument documentation, tool results and errors, the system prompt — refers to other tools by their model call name, such as `workspace_read_file`, and says "this tool" for the tool being called. Profiles, run records, and the settings UI use the stable ID.

Tool preparation builds bindings from the catalog, the Chat or Session scenario, and the Profile's selection, and the Invocation then applies completion protocols on its own to form a snapshot holding descriptions, arguments, and the name mapping. Output revision reuses the original snapshot. After `tool_request_gate` checks the snapshot and this round's tool selection, the call is dispatched explicitly to Builtin, MCP, or Extension.

New Profiles enable Shell by default.

## Built-in tools

The table uses the tool names from the source. Arguments follow the [descriptor definitions](../../src-tauri/crates/tt-application/src/services/agent_tools) and the schema `api.agent.tools.list()` returns.

| Work | Tools |
| --- | --- |
| Reading the chat | `chat.search`, `chat.read_messages` |
| Reading activated World Info | `worldinfo.read_activated` |
| Reading working files and skills | `workspace.list_files`, `workspace.search_files`, `workspace.read_file` |
| Changing files | `workspace.write_file`, `workspace.apply_patch` |
| Shell and data processing | `workspace.shell`, with jq, Python, and JavaScript inside |
| Publishing and finishing | `workspace.commit`, `workspace.finish` |
| Delegation and handoff | `agent.delegate`, `agent.await`, `agent.handoff`, `task.return` |
| Rolling dice | `dice.roll` |

Chat tools read the history range the run input covers; file reads use 1-based line numbers and chat message indexes use 0-based. Longer text can be read in segments. The full tool set narrows according to the Profile, and a return-mode child agent uses `task.return` as its finishing tool.

The callable agent catalog comes with the prompt; see [Multi-agent collaboration](SubAgent.md) for collaboration and error feedback.

## Arguments

A call carries one set of named arguments. On the wire it is either a JSON object or the JSON encoding of that object as a string, and "no arguments" has several equivalent spellings across implementations (a missing field, `null`, `""`, `"null"`, `"{}"`). `ToolArguments` is the only conversion point: it strips the string encoding first and then applies one rule, so both encodings give the same argument set, and a tool whose arguments are all optional can be called with none.

Anything that is neither an object nor one of the empty spellings above (truncated JSON, an array, a scalar) is kept as it is. The runtime rejects such a call before dispatch, returns the recoverable `tool.invalid_arguments`, and echoes the beginning of the raw text; a tool itself only ever receives arguments already confirmed to be an object.

Replay across channels uses object arguments uniformly: a valid object keeps its value, invalid arguments replay as `{}`, and the paired tool error carries the rejection reason. Persistence still keeps the raw invalid arguments.

## Shell

`workspace.shell` provides the Bashkit built-in commands, jq, a Python subset, and JavaScript. The arguments are `command` and an optional `workdir` (default `/`). Every call creates a new environment while the shared workspace files persist; host external programs never run. Exit status and output come back as an ordinary tool result; see [Workspace](Workspace.md) for the execution and file contracts.

## How results enter the next round

`AgentToolResult` holds the call ID, the tool ID, text, structured results, error information, resource references, and image references. The model reads the `content` and the images, and an error result carries an explicit error marker; structured metadata stays in the record and is never expanded into model text automatically.

Tool images are decoded byte by byte and normalized once on ingest: a PNG, JPEG, or WebP with a long edge of at most 1280 pixels and at most 1,000,000 bytes is stored as it is, otherwise it converts to JPEG on a white background (quality 85) and shrinks as needed. The workspace `tool-results/` holds the image files, and results, audits, and Session history record only `{ path, mimeType }`. An image stays in the context with its message until Session compaction removes that message; when the model does not accept images, the result explains why in the same position. Images that cannot be decoded, or that are still too large after normalization, are noted at the end of the result in return order without affecting the tool's other returned content. Image encoding and storage failures propagate to the run's wrap-up.

Model-facing text has distinct jobs: the prompt states duties and how to finish, a tool states its purpose and arguments, a result reports facts, and an error states the problem and any known remedy. Measure brevity by the cost of understanding, and keep the content boundaries and next steps that matter; internal configuration, identity, and audit details stay in the records.

MCP and extension tools share result auditing and long result handling. Above the [Profile inline threshold](ProfilesAndPreset.md#adjusting-how-the-agent-works), the raw JSON stays for audit and the complete readable content goes to a read-only `tool-results/` file; the model receives a leading preview, the character limit, a note that it is incomplete, and the file path, plus guidance to read, page, or search with the available tools. Interrupted history keeps calls paired with their results; when a result is unknown, it reminds the model to check state before repeating the operation.

Request errors the model can fix also come back as a tool result, such as invalid arguments, an incorrect read range, or a file that changed. Storage and run state errors propagate to the run's wrap-up. The body text shown in the chat comes from a workspace commit.

## MCP and skills

MCP Manager owns servers, the discovered catalog, and call permissions; an agent uses the discovered catalog, and the MCP service confirms permission before a call. See [MCP](../CurrentState/MCP.md) for configuration and connection behaviour.

Skills supply working methods, material, and scripts, used through the read-only `skills/` view and `workspace.shell`; see [Skill](Skill.md) for organization and scope.

## Extension tools

An extension registers plain JS functions at startup and applies them to Chat, Session, or both, see [registering extension tools](../API/Agent.md#registering-extension-tools). The Tauri host handles WebView communication and waits for the receipt, and offers the catalog and the call capability to the runtime through `tt-ports::extension_tools::ExtensionTools`.

Execution looks up the currently enabled function by stable ID, and the tool snapshot holds no function instance. An extension returns plain JSON and can attach images to this successful receipt with `context.attachImage(blob)`; when the handler throws, the attached images are dropped. A tool declaring `returnsImages: true` is offered only to Invocations known at binding time to accept images, otherwise it produces an `extension.tool_needs_image_input` diagnostic; the catalog still contains those tools. Other tools can attach images too, and the [assembly snapshot](PromptAssembly.md#one-assembly-one-live-exception) decides whether the model accepts them. MCP responses are normalized by their own protocol and then enter the common result handling path.

## Adding a tool

Start from a similar built-in tool, implement its argument documentation and execution logic, then register it in `BuiltinAgentToolRegistry`. A tool returns content for the model to keep working with; when it needs a file change, a commit, or task control, hand that to the runtime through an existing `AgentToolEffect` to record and handle.

When you need external capabilities such as network, files, or a script engine, follow the repository's port and adapter boundaries. Verify from the observable call results and side effects, see [Testing](TestingStrategy.md).

- [registry.rs](../../src-tauri/crates/tt-application/src/services/agent_tools/registry.rs): the built-in catalog.
- [policy.rs](../../src-tauri/crates/tt-application/src/services/agent_tools/policy.rs): the Invocation tool snapshot.
- [tool.rs](../../src-tauri/crates/tt-domain/src/models/tool.rs): the wire encoding conversion rules for `ToolArguments`.
- [tool_request_gate.rs](../../src-tauri/crates/tt-application/src/services/tool_request_gate.rs): tool call checks.
- [tool_execution.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/tool_execution.rs): dispatch and records.
- [tool_catalog.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/tool_catalog.rs): the catalog, availability, and validation when a Profile newly enables a tool.
- [tool_results.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/tool_results.rs): result mapping, auditing, and the shared long result projection.
- [workspace/shell.rs](../../src-tauri/crates/tt-application/src/services/agent_tools/workspace/shell.rs): Shell arguments and result mapping.
