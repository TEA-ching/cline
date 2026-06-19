import { useState } from "react";
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";
import { EmptyRequest, KeypoolCheckUpdateResponse, KeypoolInstallUpdateRequest } from "@shared/proto/index.cline";
import Section from "../Section";
import { buildDate } from "../../../config/BuildDate.ts";
import { ModelsServiceClient } from "@/services/grpc-client";

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

console.log("Build date:", buildDate.toISOString())

const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	type CheckState = "idle" | "checking" | "update_available" | "up_to_date" | "error"
	type InstallState = "idle" | "installing" | "done" | "error"
	const [checkState, setCheckState] = useState<CheckState>("idle")
	const [installState, setInstallState] = useState<InstallState>("idle")
	const [updateInfo, setUpdateInfo] = useState<KeypoolCheckUpdateResponse | null>(null)
	const [updateError, setUpdateError] = useState<string | null>(null)

	const handleCheckUpdate = async () => {
		setCheckState("checking")
		setUpdateError(null)
		setUpdateInfo(null)
		setInstallState("idle")
		try {
			const res = await ModelsServiceClient.keypoolCheckUpdate(EmptyRequest.create({}))
			if (res.error) {
				setUpdateError(res.error)
				setCheckState("error")
			} else if (res.updateAvailable) {
				setUpdateInfo(res)
				setCheckState("update_available")
			} else {
				setUpdateInfo(res)
				setCheckState("up_to_date")
			}
		} catch (e) {
			setUpdateError(e instanceof Error ? e.message : String(e))
			setCheckState("error")
		}
	}

	const handleInstallUpdate = async () => {
		if (!updateInfo?.downloadUrl) return
		setInstallState("installing")
		setUpdateError(null)
		try {
			const res = await ModelsServiceClient.keypoolInstallUpdate(
				KeypoolInstallUpdateRequest.create({ downloadUrl: updateInfo.downloadUrl, assetName: updateInfo.assetName })
			)
			if (res.success) {
				setInstallState("done")
			} else {
				setUpdateError(res.error ?? "Installation failed")
				setInstallState("error")
			}
		} catch (e) {
			setUpdateError(e instanceof Error ? e.message : String(e))
			setInstallState("error")
		}
	}

	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 id="about_title" className="text-lg font-semibold">Cline v{version} with Keypool Live</h2>
					<p>
						An AI assistant that can use your CLI and Editor. Cline can handle complex software development tasks
						step-by-step with tools that let him create & edit files, explore large projects, use the browser, and
						execute terminal commands (after you grant permission).
					</p>

					<h3 className="text-md font-semibold">Community & Support</h3>
					<p>
						<VSCodeLink href="https://x.com/cline">X</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://discord.gg/cline">Discord</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://www.reddit.com/r/cline/"> r/cline</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Development</h3>
					<p>
						<VSCodeLink href="https://github.com/cline/cline">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/issues"> Issues</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop">
							{" "}
							Feature Requests
						</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Resources</h3>
					<p>
						<VSCodeLink href="https://cline.bot/">https://cline.bot</VSCodeLink>
					</p>

					{/* Extension update */}
					<div className="mt-4">
						<h3 className="text-md font-semibold">Extension Update</h3>
						<div className="flex items-center gap-2 flex-wrap">
							<button
								disabled={checkState === "checking" || installState === "installing"}
								onClick={handleCheckUpdate}
								className="px-2 py-1 text-sm bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] rounded disabled:opacity-50 disabled:cursor-not-allowed">
								{checkState === "checking" ? "Checking…" : "Check for update"}
							</button>

							{checkState === "up_to_date" && updateInfo && (
								<span className="text-xs text-[var(--vscode-descriptionForeground)]">
									You have the latest version ({updateInfo.currentVersion})
								</span>
							)}

							{checkState === "update_available" && updateInfo && installState === "idle" && (
								<>
									<span className="text-xs text-[var(--vscode-descriptionForeground)]">
										{updateInfo.currentVersion} → {updateInfo.latestVersion} ({updateInfo.assetName})
									</span>
									<button
										onClick={handleInstallUpdate}
										className="px-2 py-1 text-sm bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded">
										Install update
									</button>
								</>
							)}

							{installState === "installing" && (
								<span className="text-xs text-[var(--vscode-descriptionForeground)]">Installing…</span>
							)}

							{installState === "done" && (
								<span className="text-xs text-[var(--vscode-descriptionForeground)]">
									Update installed. Restart the extension host to apply (Developer: Restart Extension Host).
								</span>
							)}

							{(checkState === "error" || installState === "error") && updateError && (
								<span className="text-xs text-[var(--vscode-errorForeground)]">{updateError}</span>
							)}
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
