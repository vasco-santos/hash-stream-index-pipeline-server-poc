// Streamer
import { HashStreamer } from '@hash-stream/streamer'

// Index
import { IndexReader } from '@hash-stream/index/reader'
import { FSIndexStore } from '@hash-stream/index/store/fs'
import {
  MultipleLevelIndexWriter,
  SingleLevelIndexWriter,
} from '@hash-stream/index'

// Pack
import { UnixFsPackReader } from '@hash-stream/utils/index/unixfs-pack-reader'
import { FSPackStore } from '@hash-stream/pack/store/fs'

// Index Scheduler
import { FSFileStore } from '@hash-stream/index-pipeline/file-store/fs'
import { MemoryIndexScheduler } from '@hash-stream/index-pipeline/index-scheduler/memory'

/**
 * @param {string} hashStreamPath - Path to the hash stream server stores
 * @param {string} rawContentStorePath - Path to the raw content store
 */
export function getHashStreamer(hashStreamPath, rawContentStorePath) {
  const indexStore = new FSIndexStore(`${hashStreamPath}/index`)
  const packStore = new FSPackStore(`${hashStreamPath}/pack`)
  const fileStore = new FSPackStore(rawContentStorePath, {
    prefix: '',
    extension: '',
  })

  const indexReader = new IndexReader(indexStore)
  const packReader = new UnixFsPackReader(packStore, fileStore)

  return new HashStreamer(indexReader, packReader)
}

/**
 * @param {string} hashStreamPath - Path to the hash stream server stores
 * @param {string} rawContentStorePath - Path to the raw content store
 * @param {import('@hash-stream/index-pipeline/types').QueuedIndexTask[]} queue - Queue for indexing tasks
 */
export function getIndexSchedulerContext(
  hashStreamPath,
  rawContentStorePath,
  queue
) {
  const indexStore = new FSIndexStore(`${hashStreamPath}/index`)
  const packStore = new FSPackStore(`${hashStreamPath}/pack`)
  const fileSyncedStore = new FSFileStore(`${hashStreamPath}/file-synced`)
  const fileStore = new FSFileStore(rawContentStorePath)

  const multipleLevelindexWriter = new MultipleLevelIndexWriter(indexStore)
  const singleLevelIndexWriter = new SingleLevelIndexWriter(indexStore)
  // Uses both writers to allow for single-level and multiple-level indexing
  // Not recommended to use both writers in production, but useful for testing
  const indexWriters = [singleLevelIndexWriter, multipleLevelindexWriter]
  const indexScheduler = new MemoryIndexScheduler(queue)

  return {
    fileStore,
    fileSyncedStore,
    packStore,
    indexWriters,
    indexScheduler,
  }
}
