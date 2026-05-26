// KeypoolLiveProvider — Settings component for the keypoollive provider
// © 2026 Ronan LE MEILLAT — MIT License

import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface KeypoolLiveProviderProps {
	isPopup?: boolean
	currentMode: Mode
}

export const KeypoolLiveProvider = ({ isPopup: _isPopup, currentMode: _currentMode }: KeypoolLiveProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<p style={{ fontSize: 12, marginTop: 0, marginBottom: 8, color: "var(--vscode-descriptionForeground)" }}>
				KeypoolLive loads AI provider API keys from an AES-256-CBC encrypted vault and manages key rotation automatically.
			</p>

			{/* Vault URL */}
			<DebouncedTextField
				initialValue={apiConfiguration?.keypoolliveVaultUrl || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: { options: { keypoolliveVaultUrl: value || undefined } },
							updateMask: ["options.keypoolliveVaultUrl"],
						}),
					)
				}}
				placeholder="https://example.com/ai.json.enc"
				style={{ width: "100%" }}
				type="text">
				<div className="flex items-center gap-2 mb-1">
					<span style={{ fontWeight: 500 }}>Vault URL</span>
				</div>
			</DebouncedTextField>

			{/* Vault Secret */}
			<DebouncedTextField
				initialValue={apiConfiguration?.keypoolliveSecret || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: { secrets: { keypoolliveSecret: value || undefined } },
							updateMask: ["secrets.keypoolliveSecret"],
						}),
					)
				}}
				placeholder="Vault decryption secret"
				style={{ width: "100%" }}
				type="password">
				<div className="flex items-center gap-2 mb-1">
					<span style={{ fontWeight: 500 }}>Vault Secret</span>
				</div>
			</DebouncedTextField>

			{/* Model ID */}
			<DebouncedTextField
				initialValue={
					(apiConfiguration?.actModeApiModelId !== undefined ? apiConfiguration?.actModeApiModelId : "") || ""
				}
				onChange={(value) => handleFieldChange("actModeApiModelId", value)}
				placeholder="e.g. openai/gpt-4o or anthropic/claude-3-5-sonnet"
				style={{ width: "100%" }}
				type="text">
				<div className="flex items-center gap-2 mb-1">
					<span style={{ fontWeight: 500 }}>Model ID</span>
				</div>
			</DebouncedTextField>
			<p style={{ fontSize: 11, margin: "2px 0 12px 0", color: "var(--vscode-descriptionForeground)" }}>
				Format: <code>providerName/modelId</code> (e.g. <code>openai/gpt-4o</code>). Provider names come from the vault.
			</p>

			{/* Optional: Cloudflare AI Gateway */}
			<details style={{ marginBottom: 8 }}>
				<summary style={{ cursor: "pointer", fontWeight: 500, fontSize: 13 }}>Cloudflare AI Gateway (optional)</summary>
				<div style={{ marginTop: 8 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
						<input
							checked={apiConfiguration?.keypoolliveUseGateway ?? false}
							id="keypoollive-use-gateway"
							onChange={(e) => handleFieldChange("keypoolliveUseGateway", e.target.checked)}
							type="checkbox"
						/>
						<label htmlFor="keypoollive-use-gateway" style={{ fontSize: 13 }}>
							Route requests through Cloudflare AI Gateway
						</label>
					</div>

					<DebouncedTextField
						initialValue={apiConfiguration?.keypoolliveGatewayId || ""}
						onChange={async (value) => {
							await ModelsServiceClient.updateApiConfiguration(
								UpdateApiConfigurationRequestNew.create({
									updates: { options: { keypoolliveGatewayId: value || undefined } },
									updateMask: ["options.keypoolliveGatewayId"],
								}),
							)
						}}
						placeholder="Cloudflare account/gateway ID"
						style={{ width: "100%" }}
						type="text">
						<div className="flex items-center gap-2 mb-1">
							<span style={{ fontWeight: 500 }}>Gateway ID</span>
						</div>
					</DebouncedTextField>

					<DebouncedTextField
						initialValue={apiConfiguration?.keypoolliveGatewaySecret || ""}
						onChange={async (value) => {
							await ModelsServiceClient.updateApiConfiguration(
								UpdateApiConfigurationRequestNew.create({
									updates: { secrets: { keypoolliveGatewaySecret: value || undefined } },
									updateMask: ["secrets.keypoolliveGatewaySecret"],
								}),
							)
						}}
						placeholder="cf-aig-authorization Bearer token"
						style={{ width: "100%" }}
						type="password">
						<div className="flex items-center gap-2 mb-1">
							<span style={{ fontWeight: 500 }}>Gateway Secret</span>
						</div>
					</DebouncedTextField>

					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
						<input
							checked={apiConfiguration?.keypoolliveGatewayCacheSkip ?? false}
							id="keypoollive-cache-skip"
							onChange={(e) => handleFieldChange("keypoolliveGatewayCacheSkip", e.target.checked)}
							type="checkbox"
						/>
						<label htmlFor="keypoollive-cache-skip" style={{ fontSize: 13 }}>
							Skip Cloudflare AI Gateway cache
						</label>
					</div>
				</div>
			</details>
		</div>
	)
}
