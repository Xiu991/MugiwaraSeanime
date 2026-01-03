/// <reference path="./_external/.onlinestream-provider.d.ts" />
/// <reference path="./_external/core.d.ts" />

// ===================================================================
// Extension Mugiwara-no Streaming pour Seanime
// ===================================================================
// Regardez des animes en streaming VOSTFR/VF
// Site : https://www.mugiwara-no-streaming.com
// Auteur : Xiu991
// ===================================================================

//#region Configuration

const DevMode = true;

const originalConsoleLog = console.log;
console.log = function (...args: any[]) {
    if (DevMode) {
        originalConsoleLog.apply(console, args);
    }
};

//#endregion

class Provider {

    //#region Variables

    readonly SITE_URL = "https://www.mugiwara-no-streaming.com";
    readonly CATALOGUE_URL = "https://www.mugiwara-no-streaming.com/catalogue";
    readonly SEANIME_API = "http://127.0.0.1:43211/api/v1/proxy?url=";

    //#endregion

    //#region Settings

    getSettings(): Settings {
        return {
            episodeServers: [
                "streamsb",
                "doodstream",
                "mixdrop",
                "voe",
                "streamtape"
            ],
            supportsDub: true,
        };
    }

    //#endregion

    //#region Méthodes principales

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        console.log(`🔍 Recherche pour: "${opts.query}"`);
        
        try {
            // Mugiwara n'a pas d'API de recherche publique
            // On va charger le catalogue et chercher dedans
            const catalogueResponse = await fetch(this.CATALOGUE_URL);
            if (!catalogueResponse.ok) {
                console.error(`❌ Erreur HTTP catalogue: ${catalogueResponse.status}`);
                return [];
            }
            
            const html = await catalogueResponse.text();
            const $ = await LoadDoc(html);
            
            // Normaliser la requête de recherche
            const query = opts.query.toLowerCase()
                .replace(/[:']/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            const searchTerms = query.split(' ');
            const results: SearchResult[] = [];
            
            // Parser tous les animes du catalogue
            $("a[href^='/catalogue/']").each((i, element) => {
                const href = $(element).attr("href");
                const title = $(element).find("h3").text() || $(element).text();
                
                if (!href || !title || href === "/catalogue") return;
                
                // Normaliser le titre pour la comparaison
                const normalizedTitle = title.toLowerCase()
                    .replace(/[:']/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                // Vérifier si le titre correspond à la recherche
                const matchScore = this.calculateMatchScore(normalizedTitle, searchTerms);
                
                if (matchScore > 0.3) { // Seuil de pertinence
                    const animeUrl = href.startsWith('http') ? href : this.SITE_URL + href;
                    
                    results.push({
                        id: animeUrl,
                        title: title,
                        url: animeUrl,
                        subOrDub: opts.dub ? "dub" : "sub",
                    });
                }
            });
            
            // Trier par pertinence
            results.sort((a, b) => {
                const scoreA = this.calculateMatchScore(a.title.toLowerCase(), searchTerms);
                const scoreB = this.calculateMatchScore(b.title.toLowerCase(), searchTerms);
                return scoreB - scoreA;
            });
            
            console.log(`✅ Trouvé ${results.length} résultat(s)`);
            return results.slice(0, 10); // Limiter à 10 résultats
            
        } catch (error) {
            console.error("❌ Erreur lors de la recherche:", error);
            return [];
        }
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        console.log(`📺 Récupération des épisodes pour: ${id}`);
        
        try {
            // Charger la page de l'anime
            const response = await fetch(id);
            if (!response.ok) {
                console.error(`❌ Erreur HTTP: ${response.status}`);
                return [];
            }
            
            const html = await response.text();
            const $ = await LoadDoc(html);
            
            const episodes: EpisodeDetails[] = [];
            
            // Chercher les liens vers les saisons/épisodes
            // Structure : /catalogue/{anime}/episodes/{saison}
            const seasonLinks = $("a[href*='/episodes/']");
            
            if (seasonLinks.length() === 0) {
                console.log("Pas de saisons trouvées, vérification directe des épisodes");
                // Peut-être qu'on est déjà sur une page d'épisodes
                return await this.parseEpisodesFromPage(id, $);
            }
            
            // Si plusieurs saisons, prendre la première ou celle demandée
            const seasonUrl = seasonLinks.first().attr("href");
            if (!seasonUrl) {
                console.error("❌ Aucune URL de saison trouvée");
                return [];
            }
            
            const fullSeasonUrl = seasonUrl.startsWith('http') ? seasonUrl : this.SITE_URL + seasonUrl;
            
            // Charger la page de la saison
            const seasonResponse = await fetch(fullSeasonUrl);
            if (!seasonResponse.ok) {
                console.error(`❌ Erreur HTTP saison: ${seasonResponse.status}`);
                return [];
            }
            
            const seasonHtml = await seasonResponse.text();
            const $season = await LoadDoc(seasonHtml);
            
            return await this.parseEpisodesFromPage(fullSeasonUrl, $season);
            
        } catch (error) {
            console.error("❌ Erreur lors de la récupération des épisodes:", error);
            return [];
        }
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        console.log(`🎬 Récupération vidéo - Épisode ${episode.number} - Serveur: ${server}`);
        
        try {
            // Charger la page de l'épisode
            const response = await fetch(episode.id);
            if (!response.ok) {
                console.error(`❌ Erreur HTTP: ${response.status}`);
                return this.emptyEpisodeServer(server);
            }
            
            const html = await response.text();
            const $ = await LoadDoc(html);
            
            // Chercher les iframes ou les liens des serveurs vidéo
            const videoSources: VideoSource[] = [];
            
            // Méthode 1: Chercher les iframes
            $("iframe").each((i, element) => {
                const src = $(element).attr("src");
                if (src && this.isVideoServer(src, server)) {
                    console.log(`✅ Iframe trouvé pour ${server}: ${src}`);
                    videoSources.push({
                        url: src,
                        type: "hls",
                        quality: `${server} - Auto`,
                        subtitles: []
                    });
                }
            });
            
            // Méthode 2: Chercher dans le script les URLs
            if (videoSources.length === 0) {
                const scriptTags = $("script");
                scriptTags.each((i, element) => {
                    const scriptContent = $(element).html();
                    if (scriptContent && scriptContent.includes(server)) {
                        // Extraire l'URL du serveur depuis le script
                        const urlMatch = scriptContent.match(/['"](https?:\/\/[^'"]+)['"]/g);
                        if (urlMatch) {
                            for (const match of urlMatch) {
                                const url = match.replace(/['"]/g, '');
                                if (this.isVideoServer(url, server)) {
                                    console.log(`✅ URL trouvée dans script pour ${server}: ${url}`);
                                    videoSources.push({
                                        url: url,
                                        type: "hls",
                                        quality: `${server} - Auto`,
                                        subtitles: []
                                    });
                                }
                            }
                        }
                    }
                });
            }
            
            // Si on a trouvé des sources, les extraire
            if (videoSources.length > 0) {
                // Pour chaque source, essayer d'extraire le vrai lien vidéo
                const finalSources: VideoSource[] = [];
                
                for (const source of videoSources) {
                    const extracted = await this.extractVideoFromEmbed(source.url, server);
                    if (extracted.length > 0) {
                        finalSources.push(...extracted);
                    } else {
                        finalSources.push(source);
                    }
                }
                
                const referer = episode.id.split("/").slice(0, 3).join("/");
                return {
                    headers: {
                        referer: referer,
                        origin: referer
                    },
                    server: server,
                    videoSources: finalSources
                };
            }
            
            console.error(`❌ Aucune source vidéo trouvée pour le serveur: ${server}`);
            return this.emptyEpisodeServer(server);
            
        } catch (error) {
            console.error("❌ Erreur lors de la récupération de la vidéo:", error);
            return this.emptyEpisodeServer(server);
        }
    }

    //#endregion

    //#region Méthodes utilitaires

    private calculateMatchScore(text: string, searchTerms: string[]): number {
        let score = 0;
        const textWords = text.split(' ');
        
        for (const term of searchTerms) {
            if (text.includes(term)) {
                score += 1;
                // Bonus si le terme est un mot complet
                if (textWords.includes(term)) {
                    score += 0.5;
                }
            }
        }
        
        return score / searchTerms.length;
    }

    private async parseEpisodesFromPage(pageUrl: string, $: any): Promise<EpisodeDetails[]> {
        const episodes: EpisodeDetails[] = [];
        
        // Chercher les liens d'épisodes
        // Structure possible : /catalogue/{anime}/episodes/{saison}/{episode}
        $("a[href*='episode']").each((i, element) => {
            const href = $(element).attr("href");
            const text = $(element).text();
            
            if (!href) return;
            
            // Extraire le numéro d'épisode
            const epMatch = href.match(/episode[s]?[-_\/]?(\d+)/i) || text.match(/(?:episode|ep\.?)\s*(\d+)/i);
            const episodeNumber = epMatch ? parseInt(epMatch[1], 10) : episodes.length + 1;
            
            const episodeUrl = href.startsWith('http') ? href : this.SITE_URL + href;
            
            episodes.push({
                id: episodeUrl,
                url: episodeUrl,
                number: episodeNumber
            });
        });
        
        // Si aucun épisode trouvé, chercher des boutons ou divs cliquables
        if (episodes.length === 0) {
            $("button, div[data-episode], [class*='episode']").each((i, element) => {
                const dataEp = $(element).attr("data-episode");
                const onClick = $(element).attr("onclick");
                
                if (dataEp || onClick) {
                    const episodeNumber = dataEp ? parseInt(dataEp, 10) : i + 1;
                    // Pour l'instant, utiliser l'URL de la page comme base
                    episodes.push({
                        id: `${pageUrl}?ep=${episodeNumber}`,
                        url: `${pageUrl}?ep=${episodeNumber}`,
                        number: episodeNumber
                    });
                }
            });
        }
        
        console.log(`✅ Trouvé ${episodes.length} épisode(s)`);
        return episodes.sort((a, b) => a.number - b.number);
    }

    private isVideoServer(url: string, serverName: string): boolean {
        const lowerUrl = url.toLowerCase();
        const lowerServer = serverName.toLowerCase();
        
        return lowerUrl.includes(lowerServer) ||
               lowerUrl.includes(serverName.replace('stream', '')) ||
               this.getSettings().episodeServers.some(s => lowerUrl.includes(s.toLowerCase()));
    }

    private async extractVideoFromEmbed(embedUrl: string, serverName: string): Promise<VideoSource[]> {
        try {
            console.log(`🔍 Extraction vidéo depuis embed: ${embedUrl}`);
            
            const response = await fetch(`${this.SEANIME_API}${encodeURIComponent(embedUrl)}`);
            const html = await response.text();
            
            const videoSources: VideoSource[] = [];
            
            // Chercher les liens m3u8
            const m3u8Regex = /https?:\/\/[^'"\\s]+\.m3u8(?:\?[^\s'"\\]*)?/g;
            const m3u8Matches = html.match(m3u8Regex);
            
            if (m3u8Matches) {
                for (const url of m3u8Matches) {
                    videoSources.push({
                        url: url,
                        type: "hls",
                        quality: `${serverName} - Auto`,
                        subtitles: []
                    });
                }
            }
            
            // Chercher les liens mp4
            const mp4Regex = /https?:\/\/[^'"\\s]+\.mp4(?:\?[^\s'"\\]*)?/g;
            const mp4Matches = html.match(mp4Regex);
            
            if (mp4Matches) {
                for (const url of mp4Matches) {
                    const quality = this.detectQuality(url) || "Auto";
                    videoSources.push({
                        url: url,
                        type: "mp4",
                        quality: `${serverName} - ${quality}`,
                        subtitles: []
                    });
                }
            }
            
            return videoSources;
            
        } catch (error) {
            console.error("❌ Erreur lors de l'extraction depuis l'embed:", error);
            return [];
        }
    }

    private detectQuality(url: string): string | null {
        const match = url.match(/(\d{3,4})p/);
        return match ? match[1] + "p" : null;
    }

    private emptyEpisodeServer(server: string): EpisodeServer {
        return {
            headers: {},
            server: server + " (non disponible)",
            videoSources: []
        };
    }

    //#endregion
}
