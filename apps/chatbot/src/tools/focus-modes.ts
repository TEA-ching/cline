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
// This module is imported from `tools/index.ts` and `deep-research-tool.ts`,
// both reachable from the agent Worker's dynamic `import('@/tools/index')` —
// see agent.worker.ts. It must stay free of `react`/`lucide-react` imports:
// those pull a bundled copy of React (with its unguarded `process.env.NODE_ENV`
// dev/prod switch) into the Worker's chunk graph, which throws
// "process is not defined" at Worker init since Workers have no `process` global.
// UI-facing icons/labels live in `focus-modes-ui.tsx` instead.
export type FocusMode = "web" | "academic" | "news" | "video" | "social";

export interface FocusConfig {
	label: string;
	includeDomains?: string[];
	excludeDomains  ?: string[];
}

export const FOCUS_MODES: Record<FocusMode, FocusConfig> = {
	web: {
		label: "Web",
	},
	academic: {
		label: "Academic",
		includeDomains: [
			// Prépublications et archives
			"arxiv.org",
			"hal.science",
			"hal.archives-ouvertes.fr",
			"zenodo.org",
			"figshare.com",
			"osf.io",
			"biorxiv.org",
			"medrxiv.org",
			"chemrxiv.org",

			// Moteurs de recherche académiques
			"scholar.google.com",
			"semanticscholar.org",
			"researchgate.net",
			"academia.edu",
			"connectedpapers.com",
			"inciteful.xyz",
			"lens.org",

			// Bases de données bibliographiques
			"pubmed.ncbi.nlm.nih.gov",
			"pubmedcentral.ncbi.nlm.nih.gov",
			"ncbi.nlm.nih.gov",
			"jstor.org",
			"scopus.com",
			"webofscience.com",
			"crossref.org",
			"doi.org",

			// Revues scientifiques majeures
			"nature.com",
			"science.org",
			"sciencemag.org",
			"cell.com",
			"pnas.org",
			"sciencedirect.com",
			"springer.com",
			"springeropen.com",
			"wiley.com",
			"onlinelibrary.wiley.com",
			"tandfonline.com",
			"cambridge.org",
			"oxfordjournals.org",
			"academic.oup.com",

			// Sociétés savantes et organisations
			"ieee.org",
			"acm.org",
			"ieee-xplore.org",
			"acm.dl.org",
			"aps.org",
			"aip.org",
			"rsc.org",
			"acs.org",
			"iopscience.iop.org",

			// Accès ouvert
			"plos.org",
			"peerj.com",
			"f1000research.com",
			"gatesopenresearch.org",
			"wellcomeopenresearch.org",

			// Universités et institutions
			"mit.edu",
			"harvard.edu",
			"stanford.edu",
			"berkeley.edu",
			"caltech.edu",
			"ethz.ch",
			"epfl.ch",
			"cnrs.fr",
			"inria.fr",
			"pasteur.fr",
			"college-de-france.fr",

			// Autres ressources
			"arxiv-vanity.com",
			"paperswithcode.com",
			"huggingface.co",
			"blender.org",
			"khanacademy.org",
		],
	},
	news: {
		label: "News",
		includeDomains: [
			// International - Général
			"bbc.com",
			"bbc.co.uk",
			"reuters.com",
			"apnews.com",
			"aljazeera.com",
			"dw.com",
			"france24.com",
			"rt.com",
			"cgtn.com",
			"nhk.or.jp",

			// États-Unis
			"nytimes.com",
			"washingtonpost.com",
			"wsj.com",
			"usatoday.com",
			"latimes.com",
			"chicagotribune.com",
			"npr.org",
			"pbs.org",
			"cbsnews.com",
			"nbcnews.com",
			"abcnews.go.com",
			"foxnews.com",
			"cnn.com",
			"msnbc.com",
			"bloomberg.com",
			"ft.com",
			"thehill.com",
			"politico.com",
			"axios.com",
			"vox.com",
			"theintercept.com",
			"propublica.org",

			// Royaume-Uni
			"theguardian.com",
			"telegraph.co.uk",
			"independent.co.uk",
			"standard.co.uk",
			"mirror.co.uk",
			"express.co.uk",
			"thesun.co.uk",
			"dailymail.co.uk",

			// France
			"lemonde.fr",
			"lefigaro.fr",
			"leparisien.fr",
			"liberation.fr",
			"lesechos.fr",
			"latribune.fr",
			"lepoint.fr",
			"lobs.fr",
			"marianne.net",
			"valeursactuelles.com",
			"courrierinternational.com",
			"la-croix.com",
			"20minutes.fr",
			"ouest-france.fr",
			"sudouest.fr",

			// Technologie
			"techcrunch.com",
			"wired.com",
			"arstechnica.com",
			"theverge.com",
			"engadget.com",
			"gizmodo.com",
			"mashable.com",
			"businessinsider.com",
			"venturebeat.com",
			"9to5mac.com",
			"9to5google.com",
			"androidauthority.com",
			"xda-developers.com",

			// Économie et finance
			"economist.com",
			"forbes.com",
			"fortune.com",
			"cnbc.com",
			"marketwatch.com",
			"seekingalpha.com",
			"investopedia.com",
			"morningstar.com",
			"yahoofinance.com",

			// Science et santé
			"scientificamerican.com",
			"newscientist.com",
			"nature.com",
			"sciencemag.org",
			"medicalnewstoday.com",
			"healthline.com",
			"webmd.com",
			"mayoclinic.org",

			// Sport
			"espn.com",
			"bbc.com",
			"lequipe.fr",
			"marca.com",
			"as.com",
			"goal.com",
			"skysports.com",
			"cbssports.com",
			"nbcsports.com",

			// Culture et divertissement
			"variety.com",
			"hollywoodreporter.com",
			"deadline.com",
			"billboard.com",
			"rollingstone.com",
			"pitchfork.com",
			"consequence.net",
			"indiewire.com",

			// Agences de presse françaises
			"afp.com",
			"lefigaro.fr",
			"reuters.fr",
		],
	},
	video: {
		label: "Video",
		includeDomains: ["youtube.com", "vimeo.com", "dailymotion.com", "ina.fr"],
	},
	social: {
		label: "Social",
		includeDomains: [
			"reddit.com",
			"dev.to",
			"medium.com",
			"news.ycombinator.com",
			"stackoverflow.com",
			"github.com",
		],
	},
};

export function getFocusDomains(mode: FocusMode | undefined): {
	includeDomains?: string[];
	excludeDomains?: string[];
} {
	if (!mode || mode === "web") return {};
	return FOCUS_MODES[mode] ?? {};
}
