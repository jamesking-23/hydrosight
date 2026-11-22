export type Row = Record<string, unknown>;

/** Minimal read-only data access. The real implementation runs as the signed-in person (RLS applies). */
export interface DataClient {
  select(
    table: string,
    o: {
      columns: string;
      eq?: Record<string, string>;
      inList?: Record<string, string[]>;
      gte?: Record<string, string>;
      order?: { column: string; ascending: boolean };
      limit: number;
    },
  ): Promise<{ data: Row[] | null; error: { message: string } | null }>;
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export type RefKind =
  | "station"
  | "sensor"
  | "reading"
  | "device"
  | "prediction"
  | "alert"
  | "asset"
  | "report";

/** One record a tool returned. `ref` is what an answer must cite. */
export interface ToolRecord {
  ref: string; // "<kind>:<uuid>"
  kind: RefKind;
  as_of: string | null; // when the underlying observation/forecast was made
  stale: boolean | null; // null = not applicable / unknown
  data: Row;
}

export interface ToolResult {
  records: ToolRecord[];
  note?: string;
  truncated?: boolean;
  error?: string;
}

export type Block =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ProviderReply {
  content: Block[];
  usage: { input: number; output: number };
}

export interface Provider {
  name: string;
  model: string;
  step(i: {
    system: string;
    messages: Message[];
    tools: ToolDef[];
    maxTokens: number;
  }): Promise<ProviderReply>;
}

export interface CitedItem {
  text: string;
  cites: { ref: string; as_of: string | null; stale: boolean | null }[];
}
export interface AssistantAnswer {
  observed: CitedItem[];
  forecast: CitedItem[];
  assumptions: string[];
  not_known: string[];
  data_notes: string[]; // added by the server from the records, not by the model
  generated_at: string;
}

export type TurnStatus = "answered" | "refused" | "error";
export interface ToolCallLog {
  name: string;
  input: Record<string, unknown>;
  records: number;
  error?: string;
  flagged_instruction_like?: number;
}
export interface TurnResult {
  status: TurnStatus;
  answer: AssistantAnswer | null;
  refusal_reason: string | null;
  tool_calls: ToolCallLog[];
  tokens_in: number;
  tokens_out: number;
  flags: Record<string, unknown>;
}
