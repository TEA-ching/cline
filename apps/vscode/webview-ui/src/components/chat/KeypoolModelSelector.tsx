// KeypoolLive — Dropdown sélecteur de modèle dans la toolbar
// © 2026 Ronan LE MEILLAT — MIT License

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
	currentModelId: string
	onSelect: (combinedId: string) => void
}

const KeypoolModelSelector: React.FC<Props> = ({ currentModelId, onSelect }) => {
	const [isVisible, setIsVisible] = useState(false)
	const [models, setModels] = useState<KeypoolVaultModel[]>([])
	const [loading, setLoading] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)

	useEffect(() => {
		if (isVisible) {
			setLoading(true)
			ModelsServiceClient.keypoolGetVaultModels(EmptyRequest.create({}))
				.then((resp) => {
					setModels(resp.models)
					setKplModelCache(resp.models)
				})
				.catch(() => {
					setModels([])
				})
				.finally(() => {
					setLoading(false)
				})
		}
	}, [isVisible])

	useClickAway(modalRef, () => setIsVisible(false))

	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect()
			const center = rect.left + rect.width / 2
			setArrowPosition(document.documentElement.clientWidth - center - 5)
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
