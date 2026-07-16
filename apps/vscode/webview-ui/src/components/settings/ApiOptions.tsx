			{apiConfiguration && selectedProvider === "keypoollive" && (
				<KeypoolLiveProvider currentMode={currentMode} isPopup={isPopup} />
			)}

			{apiConfiguration && (selectedProvider === "openai" || isCustomProvider) && (
				<OpenAICompatibleProvider
					currentMode={currentMode}
					isPopup={isPopup}
					providerId={selectedProvider}
					showModelOptions={showModelOptions}
				/>
			)}