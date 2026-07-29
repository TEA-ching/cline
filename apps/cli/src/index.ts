#!/usr/bin/env bun

import { isMainThread } from "node:worker_threads";
import { disposeAll, initVcr, isHubDaemonProcess } from "@cline/shared";
// @ts-expect-error -- resolved by Bun's "file" import attribute at build time,
// not by the TS module resolver.
import parserWorkerPath from "@opentui/core/parser.worker" with { type: "file" };
import { logCliProcessError } from "./logging/errors";
import {
	abortActiveRuntime,
	cleanupActiveRuntime,
	isAbortInProgress,
} from "./runtime/active-runtime";
import { writeErr } from "./utils/output";

// Initialize VCR before any HTTP requests are made.
// Set CLINE_VCR=record|playback and CLINE_VCR_CASSETTE=<path> to enable.
initVcr(process.env.CLINE_VCR);

// Tell @opentui/core's TreeSitterClient where to find its parser worker via a
// real file-asset import instead of a second `Bun.build` entrypoint. The
// previous approach (parser.worker.js as a second compile entrypoint,
// requiring `splitting: true`) let the compiled binary bundle a duplicate
// copy of React/the OpenTUI reconciler across the resulting chunks, crashing
// interactive mode with "null is not an object (evaluating '...useState')".
// `with { type: "file" }` embeds the (already self-contained) worker file as
// a plain asset in the compiled executable without touching the module graph.
process.env.OTUI_TREE_SITTER_WORKER_PATH ??= parserWorkerPath;

if (!isMainThread) {
	// Worker imports of the bundled CLI entrypoint should not start the CLI.
} else {
	let shuttingDown = false;
	let handlingFatalProcessError = false;
	const forwardSignalToRuntime = () => {
		if (shuttingDown) {
			process.exit(1);
		}
		shuttingDown = true;
		abortActiveRuntime();
	};
	process.on("SIGINT", forwardSignalToRuntime);
	process.on("SIGTERM", forwardSignalToRuntime);
	const handleFatalProcessError = (kind: string, error: unknown) => {
		if (handlingFatalProcessError) {
			process.exit(1);
		}
		handlingFatalProcessError = true;
		logCliProcessError(kind, error);
		writeErr(
			error instanceof Error ? (error.stack ?? error.message) : String(error),
		);
		cleanupActiveRuntime();
		abortActiveRuntime();
		void disposeAll().finally(() => {
			process.exit(1);
		});
	};
	process.on("uncaughtException", (error) => {
		handleFatalProcessError("uncaughtException", error);
	});
	process.on("unhandledRejection", (reason, promise) => {
		if (isAbortInProgress()) {
			// Mark the promise as handled so OpenTUI's error overlay
			// does not surface expected abort-related rejections.
			promise.catch(() => {});
			return;
		}
		handleFatalProcessError("unhandledRejection", reason);
	});

	void (async () => {
		if (isHubDaemonProcess()) {
			await import("@cline/core/hub/daemon-entry");
			return;
		}

		let exitCode = 0;
		try {
			const { runCli } = await import("./main");
			await runCli();
		} catch (err) {
			logCliProcessError("runCli", err);
			writeErr(err instanceof Error ? err.message : String(err));
			cleanupActiveRuntime();
			abortActiveRuntime();
			exitCode = 1;
		} finally {
			await disposeAll();
		}
		process.exit(exitCode || (process.exitCode as number) || 0);
	})();
}
