import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface Job {
  readonly key: string;
  readonly url: string;
  /** Relative share of the total progress bar, roughly proportional to bytes. */
  readonly weight: number;
}

/**
 * Promise-based glTF loading with aggregated progress.
 *
 * Replaces the previous "increment a counter in every callback" approach, which
 * could double-count on an error path and left the loader stuck at 85% forever
 * if a single asset 404'd. Here a rejection propagates, so the UI can show a
 * real failure instead of an eternal spinner.
 */
export class AssetLoader {
  private readonly loader = new GLTFLoader();
  /** Per-job fraction in [0,1], keyed by job key. */
  private readonly progress = new Map<string, number>();

  constructor(private readonly onProgress: (fraction01: number) => void) {}

  /**
   * Loads every job in parallel and resolves with a key → GLTF record.
   * Rejects with the first failure, naming the asset that could not be fetched.
   */
  async loadAll<K extends string>(jobs: readonly (Job & { key: K })[]): Promise<Record<K, GLTF>> {
    const totalWeight = jobs.reduce((sum, j) => sum + j.weight, 0) || 1;

    const report = () => {
      let done = 0;
      for (const job of jobs) done += (this.progress.get(job.key) ?? 0) * job.weight;
      this.onProgress(done / totalWeight);
    };

    const entries = await Promise.all(
      jobs.map(async (job) => {
        const gltf = await this.loadOne(job, report);
        return [job.key, gltf] as const;
      }),
    );

    this.onProgress(1);
    return Object.fromEntries(entries) as Record<K, GLTF>;
  }

  private loadOne(job: Job, report: () => void): Promise<GLTF> {
    return new Promise<GLTF>((resolve, reject) => {
      this.loader.load(
        job.url,
        (gltf) => {
          this.progress.set(job.key, 1);
          report();
          resolve(gltf);
        },
        (event) => {
          // `total` is 0 when the server sends no Content-Length. Fall back to
          // holding the last known value rather than dividing by zero.
          if (event.total > 0) {
            this.progress.set(job.key, Math.min(1, event.loaded / event.total));
            report();
          }
        },
        (error) => {
          reject(new Error(`Failed to load ${job.url}: ${(error as Error)?.message ?? error}`));
        },
      );
    });
  }
}
