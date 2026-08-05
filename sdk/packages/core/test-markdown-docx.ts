/**
 * Test file for markdown-docx executor
 * Demonstrates usage in both Node.js and browser environments
 */

import { createWriteMarkdownToDocxExecutor } from "./src/extensions/tools/executors/markdown-docx";

// Mock context for testing
const mockContext = {} as any;

async function testNodeEnvironment() {
	console.log("Testing Node.js environment...");

	const executor = createWriteMarkdownToDocxExecutor();

	// Subscribe to events (will not be triggered in Node.js)
	const unsubscribeBuffer = executor.onDocxBuffer(({ buffer, markdown }) => {
		console.log(`Buffer event received: ${buffer.length} bytes`);
	});

	const unsubscribeProgress = executor.onProgress(({ progress, status }) => {
		console.log(`Progress: ${Math.round(progress * 100)}% - ${status}`);
	});

	try {
		const markdownContent =
			"# Test Document\n\nThis is a **test** of markdown to DOCX conversion.";
		const outputPath = "./test-output.docx";

		const result = await executor(markdownContent, outputPath, mockContext);
		console.log("Result:", result);

		return { success: true, result };
	} catch (error) {
		console.error("Error:", error);
		return { success: false, error };
	} finally {
		unsubscribeBuffer();
		unsubscribeProgress();
	}
}

async function testBrowserEnvironmentSimulation() {
	console.log("\nTesting browser environment simulation...");

	// Simulate browser environment by mocking the window detection
	const originalWindow = (global as any).window;
	(global as any).window = {};

	const executor = createWriteMarkdownToDocxExecutor();

	// Subscribe to events
	const bufferPromise = new Promise<{ buffer: Uint8Array; markdown: string }>(
		(resolve) => {
			executor.onDocxBuffer(resolve);
		},
	);

	const progressEvents: Array<{ progress: number; status: string }> = [];
	executor.onProgress((event) => {
		progressEvents.push(event);
		console.log(
			`Progress: ${Math.round(event.progress * 100)}% - ${event.status}`,
		);
	});

	try {
		const markdownContent =
			"# Browser Test\n\nThis should return a buffer instead of writing a file.";

		// Execute conversion
		const result = await executor(
			markdownContent,
			"ignored-path.docx",
			mockContext,
		);
		console.log("Result:", result);

		// Wait for buffer event
		const bufferData = await bufferPromise;
		console.log(`Buffer received: ${bufferData.buffer.length} bytes`);

		return {
			success: true,
			result,
			bufferSize: bufferData.buffer.length,
			progressEvents,
		};
	} catch (error) {
		console.error("Error:", error);
		return { success: false, error };
	} finally {
		// Clean up browser simulation
		if (originalWindow !== undefined) {
			(global as any).window = originalWindow;
		} else {
			delete (global as any).window;
		}
	}
}

async function runTests() {
	console.log("=== Markdown to DOCX Executor Tests ===\n");

	// Test Node.js environment
	const nodeResult = await testNodeEnvironment();

	// Test browser environment simulation
	const browserResult = await testBrowserEnvironmentSimulation();

	console.log("\n=== Test Summary ===");
	console.log("Node.js test:", nodeResult.success ? "PASSED" : "FAILED");
	console.log("Browser test:", browserResult.success ? "PASSED" : "FAILED");

	if (nodeResult.success && browserResult.success) {
		console.log(
			"\n✅ All tests passed! The executor works in both environments.",
		);
	} else {
		console.log("\n❌ Some tests failed.");
	}
}

// Run tests
runTests().catch(console.error);
