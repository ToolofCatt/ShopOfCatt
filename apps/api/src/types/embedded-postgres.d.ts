/**
 * Khai báo ambient cho 'embedded-postgres' (chỉ dùng bởi scripts/dev-db.ts).
 * Gói này phân phối ESM-only qua trường "exports" nên không thể resolve với
 * moduleResolution "Node" cổ điển — khai báo module thủ công để typecheck.
 * Chữ ký được sao chép tối giản từ embedded-postgres/dist/types.d.ts.
 */
declare module 'embedded-postgres' {
  export interface PostgresOptions {
    /** Thư mục lưu dữ liệu cluster PostgreSQL. */
    databaseDir?: string;
    user?: string;
    password?: string;
    port?: number;
    /** Giữ lại dữ liệu giữa các lần chạy. */
    persistent?: boolean;
    /** Cờ truyền cho initdb (ví dụ --encoding=UTF8). */
    initdbFlags?: string[];
    /** Cờ truyền cho tiến trình postgres. */
    postgresFlags?: string[];
    createPostgresUser?: boolean;
    onLog?: (message: string) => void;
    onError?: (messageOrError: string | Error | unknown) => void;
  }

  export default class EmbeddedPostgres {
    constructor(options?: Partial<PostgresOptions>);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
  }
}
