		const recordDeniedToolApproval = vi.fn()
		const messages = new SdkMessageCoordinator({ getTask: () => task })