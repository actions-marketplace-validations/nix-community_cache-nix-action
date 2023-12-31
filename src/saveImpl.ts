import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import * as github from "@actions/github";

import { Events, Inputs, State } from "./constants";
import { collectGarbage } from "./gc";
import { purgeCaches } from "./purge";
import { type IStateProvider } from "./stateProvider";
import * as utils from "./utils/actionUtils";

// Catch and log any unhandled exceptions.  These exceptions can leak out of the uploadChunk method in
// @actions/toolkit when a failed upload closes the file descriptor causing any in-process reads to
// throw an uncaught exception.  Instead of failing this action, just warn.
process.on("uncaughtException", e => utils.logWarning(e.message));

async function saveImpl(stateProvider: IStateProvider): Promise<number | void> {
    let cacheId = -1;
    try {
        if (!utils.isCacheFeatureAvailable()) {
            return;
        }

        if (!utils.isValidEvent()) {
            utils.logWarning(
                `Event Validation Error: The event type ${
                    process.env[Events.Key]
                } is not supported because it's not tied to a branch or tag ref.`
            );
            return;
        }

        // If restore has stored a primary key in state, reuse that
        // Else re-evaluate from inputs
        const primaryKey =
            stateProvider.getState(State.CachePrimaryKey) ||
            core.getInput(Inputs.Key);

        if (!primaryKey) {
            utils.logWarning(`Key is not specified.`);
            return;
        }

        const cachePaths = utils.paths;
        const restoreKeys = utils.getInputAsArray(Inputs.RestoreKeys);

        const enableCrossOsArchive = utils.getInputAsBool(
            Inputs.EnableCrossOsArchive
        );

        // If matched restore key is same as primary key, then do not save cache
        // NO-OP in case of SaveOnly action
        const restoredKey = await utils.getCacheKey(
            cachePaths,
            primaryKey,
            restoreKeys,
            true,
            enableCrossOsArchive
        );

        const time = Date.now();

        if (utils.isExactKeyMatch(primaryKey, restoredKey)) {
            core.info(`Cache hit occurred on the primary key ${primaryKey}.`);

            const caches = await purgeCaches(primaryKey, true, time);

            if (caches.map(cache => cache.key).includes(primaryKey)) {
                core.info(
                    `The cache with the key ${primaryKey} will be purged. Saving a new cache.`
                );
            } else {
                core.info(
                    `The cache with the key ${primaryKey} won't be purged. Not saving a new cache.`
                );

                await purgeCaches(primaryKey, false, time);

                return;
            }
        }

        await collectGarbage();

        const token = core.getInput(Inputs.Token, { required: false });
        const octokit = getOctokit(token);

        octokit.rest.actions.deleteActionsCacheByKey({
            per_page: 100,
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            key: primaryKey
        });

        cacheId = await cache.saveCache(
            cachePaths,
            primaryKey,
            {
                uploadChunkSize: utils.getInputAsInt(Inputs.UploadChunkSize)
            },
            enableCrossOsArchive
        );

        if (cacheId != -1) {
            core.info(`Cache saved with the key ${primaryKey}`);

            await purgeCaches(primaryKey, false, time);
        }
    } catch (error: unknown) {
        utils.logWarning((error as Error).message);
    }
    return cacheId;
}

export default saveImpl;
