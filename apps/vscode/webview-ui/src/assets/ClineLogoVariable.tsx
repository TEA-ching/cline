import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * ClineLogoVariable component renders the Cline logo with automatic theme adaptation
 * and environment-based color indicators.
 *
 * This component uses VS Code theme variables for the fill color, with environment-specific colors:
 * - Local: yellow/orange (development/experimental)
 * - Staging: blue (stable testing)
 * - Production: gray/white (default icon color)
 *
 * @param {SVGProps<SVGSVGElement> & { environment?: Environment }} props - Standard SVG props plus optional environment
 * @returns {JSX.Element} SVG Cline logo that adapts to VS Code themes and environment
 */
const ClineLogoVariable = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props

	// Determine fill color based on environment
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg
			fill="none"
			height="50"
			id="Calque_1"
			version="1.1"
			viewBox="0 0 92 96"
			width="47"
			x="0px"
			xmlns="http://www.w3.org/2000/svg"
			xmlnsXlink="http://www.w3.org/1999/xlink"
			xmlSpace="preserve"
			y="0px"
			{...svgProps}>
			<defs>
				<style type="text/css">
					{`.st0{fill:${fillColor};}
					.st1{fill-rule:evenodd;clip-rule:evenodd;fill:${fillColor};}
					.st2{fill:none;stroke:${fillColor};stroke-width:8;}
					.st3{opacity:0.5;fill-rule:evenodd;clip-rule:evenodd;fill:white;enable-background:new;}
					.st4{opacity:0.12;fill-rule:evenodd;clip-rule:evenodd;fill:white;enable-background:new;}`}
				</style>
			</defs>
			<path
				className="st0"
				d="M58.6,14.4c9.7,0,17.6,7.9,17.6,17.7V38l5.1,10.2c0.5,1,0.5,2.2,0,3.2l-5.1,10.1v5.9c0,9.8-7.9,17.7-17.6,17.7
				H23.3c-9.7,0-17.6-7.9-17.6-17.7v-5.9L0.5,51.5c-0.5-1-0.5-2.2,0-3.3L5.7,38v-5.9c0-9.8,7.9-17.7,17.6-17.7H58.6z M56.3,19.5H26.2
				c-8.3,0-15.1,6.8-15.1,15.1v5l-4.4,8.5c-0.5,1-0.5,2.3,0,3.3l4.4,8.4v5c0,8.3,6.8,15.1,15.1,15.1h30.2c8.3,0,15.1-6.8,15.1-15.1v-5
				l4.3-8.4c0.5-1,0.5-2.2,0-3.2l-4.3-8.5v-5C71.4,26.3,64.6,19.5,56.3,19.5z"
			/>
			<circle className="st1" cx="40.9" cy="9.8" r="9.8" />
			<path
				className="st2"
				d="M29.9,39.8L29.9,39.8c1.2,0,2.2,1,2.2,2.2v15.2c0,1.2-1,2.2-2.2,2.2l0,0c-1.2,0-2.2-1-2.2-2.2V42
				C27.7,40.8,28.7,39.8,29.9,39.8z"
			/>
			<path
				className="st2"
				d="M51.4,39.8L51.4,39.8c1.2,0,2.2,1,2.2,2.2v15.2c0,1.2-1,2.2-2.2,2.2l0,0c-1.2,0-2.2-1-2.2-2.2V42
				C49.2,40.8,50.2,39.8,51.4,39.8z"
			/>
			<g>
				<path
					className="st1"
					d="M65.1,70.8h20c1.7,0,3,1.3,3,3v16c0,1.7-1.3,3-3,3h-20c-1.7,0-3-1.3-3-3v-16C62.1,72.2,63.4,70.8,65.1,70.8z"
				/>
				<path
					className="st3"
					d="M67.1,73.8h16c1.1,0,2,0.9,2,2v12c0,1.1-0.9,2-2,2h-16c-1.1,0-2-0.9-2-2v-12C65.1,74.7,66,73.8,67.1,73.8z"
				/>
				<circle className="st4" cx="70.1" cy="81.8" r="4.2" />
				<circle className="st1" cx="70.1" cy="81.8" r="1.2" />
				<path
					className="st1"
					d="M79.1,79.8h2c0.6,0,1,0.4,1,1v4c0,0.6-0.4,1-1,1h-2c-0.6,0-1-0.4-1-1v-4C78.1,80.3,78.5,79.8,79.1,79.8z"
				/>
				<path
					className="st4"
					d="M80.1,81.3L80.1,81.3c0.3,0,0.5,0.2,0.5,0.5v2c0,0.3-0.2,0.5-0.5,0.5l0,0c-0.3,0-0.5-0.2-0.5-0.5v-2
					C79.6,81.6,79.8,81.3,80.1,81.3z"
				/>
				<path
					className="st1"
					d="M69.8,76.1L69.8,76.1c0.2-0.1,0.4,0,0.5,0.2l0.6,1.3c0.1,0.2,0,0.4-0.2,0.5h0c-0.2,0.1-0.4,0-0.5-0.2l-0.6-1.3
					C69.5,76.5,69.6,76.2,69.8,76.1z"
				/>
				<path
					className="st1"
					d="M74.1,79.5L74.1,79.5c0.2,0.1,0.3,0.3,0.2,0.5l-0.5,1.3c-0.1,0.2-0.3,0.3-0.5,0.2l0,0
					c-0.2-0.1-0.3-0.3-0.2-0.5l0.5-1.3C73.6,79.5,73.9,79.4,74.1,79.5z"
				/>
				<path
					className="st1"
					d="M70.1,84L70.1,84c0.1,0.2,0,0.4-0.1,0.5l-1.2,0.7c-0.2,0.1-0.4,0-0.5-0.1l0,0c-0.1-0.2,0-0.4,0.1-0.5l1.2-0.7
					C69.7,83.7,69.9,83.8,70.1,84z"
				/>
			</g>
		</svg>
	)
}
export default ClineLogoVariable
