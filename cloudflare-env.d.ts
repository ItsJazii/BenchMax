declare global {
  namespace Cloudflare {
    interface Env {
      ASSETS: Fetcher;
      DB: D1Database;
      GENERATION_SESSION: DurableObjectNamespace;
      GENERATE_PLATFORM_QUEUE: Queue<import("./lib/pipeline/messages").PipelineMessage>;
      EVALUATE_QUEUE: Queue<import("./lib/pipeline/messages").PipelineMessage>;
      JUDGE_QUEUE: Queue<import("./lib/pipeline/messages").PipelineMessage>;
      PIPELINE_DLQ: Queue<import("./lib/pipeline/messages").PipelineMessage>;
      IMAGES: {
        input(stream: ReadableStream): {
          transform(options: Record<string, unknown>): {
            output(options: {
              format: string;
              quality: number;
            }): Promise<{ response(): Response }>;
          };
        };
      };
      UPLOADS: R2Bucket;
    }
  }
}

export {};
