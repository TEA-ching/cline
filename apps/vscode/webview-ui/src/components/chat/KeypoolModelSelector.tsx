/**
 * KeypoolLive — Model selector dropdown in the chat toolbar.
 *
 * This component provides a quick way for users to switch between models
 * available in their KeypoolLive vault without going into the full settings page.
 *
 * © 2026 Ronan LE MEILLAT — MIT License
 */

import { EmptyRequest } from "@shared/proto/cline/common"
import { KeypoolVaultModel } from "@shared/proto/cline/models"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import PopupModalContainer from "@/components/common/PopupModalContainer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ModelsServiceClient } from "@/services/grpc-client"
import { setKplModelCache } from "./keypoolliveModelCache"

interface Props {
	/** The ID of the currently selected model (e.g., "anthropic/claude-3-5-sonnet") */
	currentModelId: string
	/** Callback function triggered when a new model is selected */
	onSelect: (combinedId: string) => void
}

/**
 * KeypoolModelSelector component renders an icon button that, when clicked,
 * opens a popup containing the list of available models from KeypoolLive.
 */
const KeypoolModelSelector: React.FC<Props> = ({ currentModelId, onSelect }) => {
	// UI State
	const [isVisible, setIsVisible] = useState(false)
	const [models, setModels] = useState<KeypoolVaultModel[]>([])
	const [loading, setLoading] = useState(false)

	// Refs for positioning and click-away detection
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)

	// Window size tracking for responsive positioning of the popup
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)

	/**
	 * Fetch the list of available models from the backend when the popup becomes visible.
	 * Results are also cached in keypoolliveModelCache for use in other parts of the UI.
	 */
	useEffect(() => {
		if (isVisible) {
			setLoading(true)
			ModelsServiceClient.keypoolGetVaultModels(EmptyRequest.create({}))
				.then((resp) => {
					setModels(resp.models)
					// Populate the in-memory cache so that model info (like context window)
					// is available immediately for UI normalization.
					setKplModelCache(resp.models)
				})
				.catch((error) => {
					console.error("Failed to fetch KeypoolLive models:", error)
					setModels([])
				})
				.finally(() => {
					setLoading(false)
				})
		}
	}, [isVisible])

	// Close the popup when clicking outside of it
	useClickAway(modalRef, () => setIsVisible(false))

	/**
	 * Calculate the position of the popup and its arrow based on the button's position.
	 * This ensures the popup is correctly aligned even if the window is resized.
	 */
	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect()
			const center = rect.left + rect.width / 2
			// Position the arrow relative to the right edge of the screen
			setArrowPosition(document.documentElement.clientWidth - center - 5)
			// Position the menu just below the button
			setMenuPosition(rect.top + 1)
		}
	}, [isVisible, viewportWidth, viewportHeight])

	return (
		<div className="inline-flex min-w-0 max-w-full items-center" ref={modalRef}>
			<div className="inline-flex w-full items-center" ref={buttonRef}>
				<Tooltip>
					{!isVisible && <TooltipContent>Select KeypoolLive model</TooltipContent>}
					<TooltipTrigger>
						<VSCodeButton
							appearance="icon"
							aria-label="Select KeypoolLive model"
							className="p-0 m-0 flex items-center"
							onClick={() => setIsVisible(!isVisible)}>
							<i className="codicon codicon-list-selection" style={{ fontSize: "12.5px" }} />
						</VSCodeButton>
					</TooltipTrigger>
				</Tooltip>
			</div>

			{isVisible && (
				<PopupModalContainer $arrowPosition={arrowPosition} $menuPosition={menuPosition}>
					<div className="flex-shrink-0 px-3 pt-2 pb-1">
						<div className="text-sm font-medium mb-1">KeypoolLive Models</div>
					</div>
					<div className="flex-1 overflow-y-auto px-2 pb-2" style={{ minHeight: 0, maxHeight: "240px" }}>
						{loading && <div className="text-xs text-muted-foreground px-1">Loading…</div>}
						{!loading && models.length === 0 && (
							<div className="text-xs text-muted-foreground px-1">No models found. Check vault settings.</div>
						)}
						{!loading &&
							models.map((m) => (
								<button
									className={`w-full text-left text-xs px-2 py-1 rounded hover:bg-muted/50 truncate ${
										m.combinedId === currentModelId
											? "font-semibold text-foreground"
											: "text-muted-foreground"
									}`}
									key={m.combinedId}
									onClick={() => {
										onSelect(m.combinedId)
										setIsVisible(false)
									}}
									title={m.title}
									type="button">
									{m.title.replace("[KeypoolLive] ", "")}
								</button>
							))}
					</div>
				</PopupModalContainer>
			)}
		</div>
	)
}

export default KeypoolModelSelector
