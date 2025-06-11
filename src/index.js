import fs from 'fs'
import path from 'path'
import os from 'os'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { CID } from 'multiformats/cid'
import { http } from '@hash-stream/utils/trustless-ipfs-gateway'
import {
  processFileForIndexing,
  scheduleStoreFilesForIndexing,
} from '@hash-stream/index-pipeline'

import { getHashStreamer, getIndexSchedulerContext } from './lib.js'

export const DAGPB_CODE = 0x70
// current only supports unixfs format
const FORMAT = 'unixfs' // Default format for indexing

// Parse CLI args
const args = process.argv.slice(2)

const portArg = args.find((arg) => arg.startsWith('--port='))
const port = portArg ? Number.parseInt(portArg.split('=')[1], 10) : 3000

const pathArg = args.find((arg) => arg.startsWith('--store-path='))
const rawHashStreamPath = pathArg
  ? pathArg.split('=')[1]
  : '~/.hash-stream-pipeline-server'

const rawPathArg = args.find((arg) =>
  arg.startsWith('--raw-content-store-path=')
)
const rawContentStorePath = rawPathArg ? rawPathArg.split('=')[1] : undefined

if (process.env.NODE_ENV !== 'test') {
  const hashStreamPath = ensureHashStreamDirectory(rawHashStreamPath)
  const normalizedRawContentStorePath =
    normalizeRawContentStorePath(rawContentStorePath)
  const indexingQueue = []
  const app = createApp(
    hashStreamPath,
    normalizedRawContentStorePath,
    indexingQueue
  ).app

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: '0.0.0.0',
    },
    (info) => {
      console.log(`Listening on http://localhost:${info.port}`) // Listening on http://localhost:3000
      console.log(`Hash Stream Stores Path: ${hashStreamPath}`)
      console.log(`Raw content Store Path: ${normalizedRawContentStorePath}`)
    }
  )
}

/**
 * Creates a Hono app configured with a specific hash stream path
 *
 * @param {string} hashStreamPath
 * @param {string} rawContentStorePath - Path to the raw content store
 * @param {import('@hash-stream/index-pipeline/types').QueuedIndexTask[]} queue - Queue for indexing tasks
 * @returns {{ app: Hono, hashStreamPath: string }}
 */
export function createApp(hashStreamPath, rawContentStorePath, queue) {
  const app = new Hono()

  app.get('/ipfs/:cid', async (c) => {
    const hashStreamer = getHashStreamer(hashStreamPath, rawContentStorePath)
    return http.ipfsGet(c.req.raw, { hashStreamer })
  })

  // TODO: Sync detached index

  app.get('/sync', async (c) => {
    const indexedFiles = []
    const schedulerContext = getIndexSchedulerContext(
      hashStreamPath,
      rawContentStorePath,
      queue
    )
    for await (const scheduledFile of scheduleStoreFilesForIndexing(
      schedulerContext.fileStore,
      schedulerContext.indexScheduler,
      { format: FORMAT }
    )) {
      // TODO: Skip if already indexed

      console.log(`Scheduled file: ${scheduledFile}`)
      // Process the file for indexing
      const containingMultihash = await processFileForIndexing(
        schedulerContext.fileStore,
        schedulerContext.packStore,
        schedulerContext.indexWriters,
        FORMAT,
        scheduledFile,
        {}
      )
      const containingCid = CID.createV1(DAGPB_CODE, containingMultihash)
      indexedFiles.push({
        file: scheduledFile,
        cid: containingCid.toString(),
      })

      // TODO: Sign them as copied for future reference

      console.log(
        `${scheduledFile} was indexed with CID: ${containingCid.toString()}`
      )
    }

    return c.json(indexedFiles)
  })

  return { app, hashStreamPath }
}

/**
 * @param {string} [rawContentStorePath]
 */
function normalizeRawContentStorePath(rawContentStorePath) {
  if (!rawContentStorePath) {
    console.error(
      'Error: --raw-content-store-path=... CLI argument is required. Please provide the path to the raw content store.'
    )
    process.exit(1)
  }

  // Expand `~` to home directory
  if (rawContentStorePath.startsWith('~')) {
    rawContentStorePath = path.join(os.homedir(), rawContentStorePath.slice(1))
  }

  // Resolve to absolute path if not already
  if (!path.isAbsolute(rawContentStorePath)) {
    rawContentStorePath = path.resolve(rawContentStorePath)
  }

  // Check that path exists
  if (!fs.existsSync(rawContentStorePath)) {
    console.error(`Error: Path does not exist: ${rawContentStorePath}`)
    process.exit(1)
  }

  return rawContentStorePath
}

/**
 * Normalizes the hash stream path (expands home directory '~', resolves to absolute path)
 * and ensures the main directory and its required subdirectories (/index, /pack) exist,
 * creating them if they don't.
 *
 * @param {string} rawPath - The raw path for the hash stream store.
 * @returns {string} The normalized and ensured absolute path for the hash stream store.
 */
function ensureHashStreamDirectory(rawPath) {
  let normalizedPath = rawPath

  // Expand `~` to home directory
  if (normalizedPath.startsWith('~')) {
    normalizedPath = path.join(os.homedir(), normalizedPath.slice(1))
  }

  // Resolve to absolute path if not already
  if (!path.isAbsolute(normalizedPath)) {
    normalizedPath = path.resolve(normalizedPath)
  }

  // Define required subdirectories
  const subDirs = ['index', 'pack']

  // Ensure the main directory exists first
  if (!fs.existsSync(normalizedPath)) {
    console.log(`Creating Hash Stream Stores Directory: ${normalizedPath}`)
    try {
      fs.mkdirSync(normalizedPath, { recursive: true })
    } catch (error) {
      console.error(
        `Error creating directory ${normalizedPath}: ${error.message}`
      )
      process.exit(1)
    }
  }

  // Ensure subdirectories exist
  for (const subDir of subDirs) {
    const subDirPath = path.join(normalizedPath, subDir)
    if (!fs.existsSync(subDirPath)) {
      console.log(`Creating subdirectory: ${subDirPath}`)
      try {
        fs.mkdirSync(subDirPath, { recursive: true })
      } catch (error) {
        console.error(
          `Error creating subdirectory ${subDirPath}: ${error.message}`
        )
        process.exit(1)
      }
    }
  }

  return normalizedPath
}
