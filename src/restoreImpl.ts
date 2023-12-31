import * as core from "@actions/core";

import { Events, Inputs, Outputs, State } from "./constants";
import { restoreExtraCaches } from "./restoreExtraCaches";
import { IStateProvider } from "./stateProvider";
import * as utils from "./utils/actionUtils";

async function restoreImpl(
    stateProvider: IStateProvider
): Promise<string | undefined> {
    try {
        if (!utils.isCacheFeatureAvailable()) {
            core.setOutput(Outputs.CacheHit, "false");
            return;
        }

        // Validate inputs, this can cause task failure
        if (!utils.isValidEvent()) {
            utils.logWarning(
                `Event Validation Error: The event type ${
                    process.env[Events.Key]
                } is not supported because it's not tied to a branch or tag ref.`
            );
            return;
        }

        const primaryKey = core.getInput(Inputs.Key, { required: true });
        stateProvider.setState(State.CachePrimaryKey, primaryKey);

        const restoreKeys = utils.getInputAsArray(Inputs.RestoreKeys);
        const cachePaths = utils.paths;
        const enableCrossOsArchive = utils.getInputAsBool(
            Inputs.EnableCrossOsArchive
        );
        const failOnCacheMiss = utils.getInputAsBool(Inputs.FailOnCacheMiss);
        const lookupOnly = utils.getInputAsBool(Inputs.LookupOnly);

        let cacheKey = await utils.getCacheKey(
            cachePaths,
            primaryKey,
            restoreKeys,
            lookupOnly,
            enableCrossOsArchive
        );

        const restoreKeyHit = utils.getInputAsBool(Inputs.RestoreKeyHit);

        const restoreKey = await utils.getCacheKey(
            cachePaths,
            primaryKey,
            restoreKeys,
            true,
            enableCrossOsArchive
        );

        if (restoreKeyHit) {
            cacheKey = restoreKey;
        }

        if (!cacheKey) {
            if (failOnCacheMiss) {
                throw new Error(
                    `Failed to restore cache entry. Exiting as fail-on-cache-miss is set. Input key: ${primaryKey}`
                );
            }
            core.info(
                `Cache not found for input keys: ${JSON.stringify([
                    primaryKey,
                    ...restoreKeys
                ])}`
            );

            await restoreExtraCaches(
                cachePaths,
                lookupOnly,
                enableCrossOsArchive
            );

            return;
        }

        // Store the matched cache key in states
        stateProvider.setState(State.CacheMatchedKey, cacheKey);

        const isExactKeyMatch =
            utils.isExactKeyMatch(
                core.getInput(Inputs.Key, { required: true }),
                cacheKey
            ) || restoreKeyHit;

        core.setOutput(Outputs.CacheHit, isExactKeyMatch.toString());
        if (lookupOnly) {
            core.info(`Cache found and can be restored from key: ${cacheKey}`);
        } else {
            core.info(`Cache restored from key: ${cacheKey}`);
        }

        await restoreExtraCaches(cachePaths, lookupOnly, enableCrossOsArchive);

        return cacheKey;
    } catch (error: unknown) {
        core.setFailed((error as Error).message);
    }
}

export default restoreImpl;
