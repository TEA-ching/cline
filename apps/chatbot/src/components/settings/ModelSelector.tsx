/*
 * MIT License
 *
 * Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { Brain, ImagePlus, Wrench } from "lucide-react";
import React from "react";
import { listChatModels, modelSupportsImages } from "@/lib/model-utils";
import type { AiConfig, AiModel } from "@/types/ai-config";

interface Props {
	config: AiConfig;
	selectedProviderId: string;
	selectedModelId: string;
	onChange: (providerId: string, modelId: string) => void;
}

/** Group models by providerId */
function groupModelsByProvider(
	models: Array<{ providerId: string; model: AiModel }>,
): Record<string, typeof models> {
	return models.reduce(
		(acc, item) => {
			const { providerId } = item;
			if (!acc[providerId]) {
				acc[providerId] = [];
			}
			acc[providerId].push(item);
			return acc;
		},
		{} as Record<string, typeof models>,
	);
}

export const ModelSelector: React.FC<Props> = ({
	config,
	selectedProviderId,
	selectedModelId,
	onChange,
}) => {
	const models = listChatModels(config);
	const groupedModels = groupModelsByProvider(models);
	const providerIds = Object.keys(groupedModels);

	return (
		<div className="space-y-1">
			{providerIds.map((providerId, index) => (
				<React.Fragment key={providerId}>
					{/* Provider separator */}
					{index > 0 && (
						<div className="mx-2 my-2 border-t border-default-200" />
					)}
					{/* Provider header */}
					<div className="px-2 py-1 text-xs font-semibold text-default-500 uppercase">
						{providerId}
					</div>
					{/* Models for this provider */}
					{groupedModels[providerId].map(({ model }) => {
						const active =
							providerId === selectedProviderId && model.id === selectedModelId;
						return (
							<button
								key={model.id}
								type="button"
								onClick={() => onChange(providerId, model.id)}
								className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
									active
										? "bg-primary-100 text-primary-700 font-medium"
										: "text-default-600 hover:bg-default-100"
								}`}
							>
								<div className="flex items-center gap-1.5">
									<span className="flex-1 truncate font-mono text-xs">
										{model.id}
									</span>
									{modelSupportsImages(model) && (
										<ImagePlus className="h-3 w-3 text-primary-400" />
									)}
									{model.supportsTools && (
										<Wrench className="h-3 w-3 text-default-400" />
									)}
									{model.supportsReasoning && (
										<Brain className="h-3 w-3 text-warning-400" />
									)}
								</div>
								<p className="text-[10px] text-default-400">
									{model.contextWindow.toLocaleString()} ctx ·{" "}
									{(model.maxOutputTokens ?? 0).toLocaleString()} out
								</p>
							</button>
						);
					})}
				</React.Fragment>
			))}
			{models.length === 0 && (
				<p className="text-xs text-default-400 italic px-2">
					No chat models in vault
				</p>
			)}
		</div>
	);
};
