	/** Tool calls rejected by the user; they should not render as red tool failures. */
	private deniedToolApprovalsByCallId = new Map<string, { toolName: string; reason: string }>()