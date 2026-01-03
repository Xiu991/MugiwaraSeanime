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

//#region Types

interface MugiwaraAnime {
    title: string;
    url: string;
    image: string;
}

interface MugiwaraSeason {
    number: number;
    url: string;
}

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
                "sibnet",
                "sendvid",
                "doodstream",
                "voe",
                "mixdrop",
                "streamtape",
                "vidmoly"
            ],
            supportsDub: true,
        };
    }

    //#endregion

    //#region Utility Methods

    private async fetchWithProxy(url: string): Promise<string> {
        try {
            const response = await fetch(`${this.SEANIME_API}${encodeURIComponent(url)}`);
            if (!response.ok) {
                console.error(`❌ Erreur HTTP: ${response.status}`);
                return "";
            }
            return await response.text();
        } catch (error) {
            console.error("❌ Erreur lors du fetch:", error);
            return "";
        }
    }

    private normalizeString(str: string): string {
        return str.toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[:']/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private calculateMatchScore(text: string, searchTerms: string[]): number {
        let score = 0;
        const normalizedText = this.normalizeString(text);
        const textWords = normalizedText.split(' ');
        
        for (const term of searchTerms) {
            const normalizedTerm = this.normalizeString(term);
            if (normalizedText.includes(normalizedTerm)) {
                score += 1;
                if (textWords.includes(normalizedTerm)) {
                    score += 0.5;
                }
            }
        }
        
        return score / searchTerms.length;
    }

    private async extractVideoFromEmbed(embedUrl: string, serverName: string): Promise<VideoSource[]> {
        try {
            console.log(`🔍 Extraction vidéo depuis embed: ${embedUrl}`);
            
            const html = await this.fetchWithProxy(embedUrl);
            if (!html) return [];
            
            const videoSources: VideoSource[] = [];
            
            // Chercher les liens m3u8
            const m3u8Regex = /https?:\/\/[^\s'"<>]+\.m3u8(?:\?[^\s'"<>]*)?/g;
            const m3u8Matches = html.match(m3u8Regex);
            
            if (m3u8Matches) {
                for (const url of m3u8Matches) {
                    // Si c'est un master.m3u8, on récupère les qualités
                    if (url.includes('master')) {
                        const qualities = await this.extractQualitiesFromMaster(url);
                        if (qualities.length > 0) {
                            videoSources.push(...qualities.map(q => ({
                                url: q.url,
                                type: "hls" as VideoSourceType,
                                quality: `${serverName} - ${q.quality}`,
                                subtitles: []
                            })));
                            continue;
                        }
                    }
                    
                    videoSources.push({
                        url: url,
                        type: "hls" as VideoSourceType,
                        quality: `${serverName} - Auto`,
                        subtitles: []
                    });
                }
            }
            
            // Chercher les liens mp4
            const mp4Regex = /https?:\/\/[^\s'"<>]+\.mp4(?:\?[^\s'"<>]*)?/g;
            const mp4Matches = html.match(mp4Regex);
            
            if (mp4Matches) {
                for (const url of mp4Matches) {
                    const quality = this.detectQuality(url) || "Auto";
                    videoSources.push({
                        url: url,
                        type: "mp4" as VideoSourceType,
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

    private async extractQualitiesFromMaster(masterUrl: string): Promise<{url: string, quality: string}[]> {
        try {
            const html = await this.fetchWithProxy(masterUrl);
            if (!html || !html.includes("#EXTM3U")) return [];
            
            const qualities: {url: string, quality: string}[] = [];
            const lines = html.split("\n");
            let currentQuality = "";
            
            for (const line of lines) {
                if (line.startsWith("#EXT-X-STREAM-INF")) {
                    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
                    if (resMatch) {
                        const height = parseInt(resMatch[1]);
                        if (height >= 1080) currentQuality = "1080p";
                        else if (height >= 720) currentQuality = "720p";
                        else if (height >= 480) currentQuality = "480p";
                        else if (height >= 360) currentQuality = "360p";
                        else currentQuality = "Auto";
                    }
                } else if (line.trim() && !line.startsWith("#")) {
                    let url = line.trim();
                    if (!url.startsWith("http")) {
                        const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/'));
                        url = `${baseUrl}/${url}`;
                    }
                    if (currentQuality) {
                        qualities.push({ url, quality: currentQuality });
                        currentQuality = "";
                    }
                }
            }
            
            return qualities;
        } catch (error) {
            console.error("❌ Erreur extraction master:", error);
            return [];
        }
    }

    private detectQuality(url: string): string | null {
        const match = url.match(/(\d{3,4})p/);
        return match ? match[1] + "p" : null;
    }

    //#endregion

    //#region Main Methods

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        console.log(`🔍 Recherche pour: "${opts.query}"`);
        console.log(`📝 Détails:`, { dub: opts.dub, format: opts.media.format });
        
        try {
            // Charger le catalogue
            console.log(`📡 Chargement du catalogue: ${this.CATALOGUE_URL}`);
            const response = await fetch(this.CATALOGUE_URL);
            if (!response.ok) {
                console.error(`❌ Erreur HTTP catalogue: ${response.status}`);
                return [];
            }
            
            const html = await response.text();
            console.log(`✅ HTML reçu, taille: ${html.length} caractères`);
            
            const $ = await LoadDoc(html);
            
            // Normaliser la requête de recherche
            const searchTerms = this.normalizeString(opts.query).split(' ');
            console.log(`🔤 Termes de recherche:`, searchTerms);
            
            const results: SearchResult[] = [];
            
            // DEBUG: Essayer plusieurs sélecteurs
            console.log(`🔎 Recherche des liens d'animes...`);
            let animeLinks = $("a[href^='/catalogue/']");
            console.log(`📌 Sélecteur 1 - a[href^='/catalogue/']: ${animeLinks.length()} éléments`);
            
            if (animeLinks.length() === 0) {
                animeLinks = $("a[href*='catalogue']");
                console.log(`📌 Sélecteur 2 - a[href*='catalogue']: ${animeLinks.length()} éléments`);
            }
            
            if (animeLinks.length() === 0) {
                animeLinks = $("a");
                console.log(`📌 Sélecteur 3 - tous les <a>: ${animeLinks.length()} éléments`);
            }
            
            // Parser tous les animes
            console.log(`🔄 Parsing de ${animeLinks.length()} liens...`);
            for (let i = 0; i < Math.min(animeLinks.length(), 50); i++) {
                const element = animeLinks.eq(i);
                const href = element.attr("href");
                
                if (!href || href === "/catalogue") continue;
                
                // Chercher le titre
                let title = element.find("h3").text().trim() || 
                           element.find("h2").text().trim() ||
                           element.find("h1").text().trim() ||
                           element.attr("title") ||
                           element.text().trim();
                
                if (!title || title.length < 2) continue;
                
                // Debug premiers résultats
                if (i < 5) {
                    console.log(`📺 Anime ${i + 1}: "${title}" -> ${href}`);
                }
                
                // Calculer le score de correspondance
                const matchScore = this.calculateMatchScore(title, searchTerms);
                
                if (matchScore > 0.3) {
                    const animeUrl = href.startsWith('http') ? href : this.SITE_URL + href;
                    
                    console.log(`✨ Match trouvé (score: ${matchScore.toFixed(2)}): "${title}"`);
                    
                    results.push({
                        id: animeUrl,
                        title: title,
                        url: animeUrl,
                        subOrDub: opts.dub ? "dub" : "sub",
                    });
                }
            }
            
            // Trier par pertinence
            results.sort((a, b) => {
                const scoreA = this.calculateMatchScore(a.title, searchTerms);
                const scoreB = this.calculateMatchScore(b.title, searchTerms);
                return scoreB - scoreA;
            });
            
            console.log(`✅ Trouvé ${results.length} résultat(s) total`);
            
            if (results.length === 0) {
                console.warn(`⚠️ Aucun résultat trouvé pour "${opts.query}"`);
                console.warn(`💡 Vérifiez les logs ci-dessus pour voir les animes disponibles`);
            }
            
            return results.slice(0, 10);
            
        } catch (error) {
            console.error("❌ Erreur lors de la recherche:", error);
            return [];
        }
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        console.log(`📺 Récupération des épisodes pour: ${id}`);
        
        try {
            const response = await fetch(id);
            if (!response.ok) {
                console.error(`❌ Erreur HTTP: ${response.status}`);
                return [];
            }
            
            const html = await response.text();
            const $ = await LoadDoc(html);
            
            const episodes: EpisodeDetails[] = [];
            
            // Méthode 1: Chercher les boutons d'épisodes
            const episodeButtons = $("button[data-episode], a[data-episode], div[data-episode]");
            
            if (episodeButtons.length() > 0) {
                for (let i = 0; i < episodeButtons.length(); i++) {
                    const element = episodeButtons.eq(i);
                    const episodeNum = parseInt(element.attr("data-episode") || "0");
                    const episodeUrl = element.attr("href") || element.attr("data-url") || `${id}/episode-${episodeNum}`;
                    
                    episodes.push({
                        id: episodeUrl.startsWith('http') ? episodeUrl : this.SITE_URL + episodeUrl,
                        url: episodeUrl.startsWith('http') ? episodeUrl : this.SITE_URL + episodeUrl,
                        number: episodeNum
                    });
                }
            }
            
            // Méthode 2: Chercher dans les scripts
            if (episodes.length === 0) {
                const scripts = $("script");
                for (let i = 0; i < scripts.length(); i++) {
                    const scriptContent = scripts.eq(i).html();
                    if (scriptContent && scriptContent.includes("episode")) {
                        // Chercher des patterns comme {episode: 1, url: "..."}
                        const episodeMatches = scriptContent.matchAll(/episode["\s:]+(\d+)/g);
                        for (const match of episodeMatches) {
                            const epNum = parseInt(match[1]);
                            episodes.push({
                                id: `${id}/episode-${epNum}`,
                                url: `${id}/episode-${epNum}`,
                                number: epNum
                            });
                        }
                        break;
                    }
                }
            }
            
            // Méthode 3: Chercher des liens directs
            if (episodes.length === 0) {
                const episodeLinks = $("a[href*='episode']");
                for (let i = 0; i < episodeLinks.length(); i++) {
                    const element = episodeLinks.eq(i);
                    const href = element.attr("href");
                    if (!href) continue;
                    
                    const epMatch = href.match(/episode[-_]?(\d+)/i);
                    if (epMatch) {
                        const epNum = parseInt(epMatch[1]);
                        const fullUrl = href.startsWith('http') ? href : this.SITE_URL + href;
                        episodes.push({
                            id: fullUrl,
                            url: fullUrl,
                            number: epNum
                        });
                    }
                }
            }
            
            // Dédupliquer et trier
            const uniqueEpisodes = Array.from(new Map(
                episodes.map(ep => [ep.number, ep])
            ).values());
            
            uniqueEpisodes.sort((a, b) => a.number - b.number);
            
            console.log(`✅ Trouvé ${uniqueEpisodes.length} épisode(s)`);
            return uniqueEpisodes;
            
        } catch (error) {
            console.error("❌ Erreur lors de la récupération des épisodes:", error);
            return [];
        }
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        console.log(`🎬 Récupération vidéo - Épisode ${episode.number} - Serveur: ${server}`);
        
        try {
            const response = await fetch(episode.id);
            if (!response.ok) {
                console.error(`❌ Erreur HTTP: ${response.status}`);
                return this.emptyEpisodeServer(server);
            }
            
            const html = await response.text();
            const $ = await LoadDoc(html);
            
            const videoSources: VideoSource[] = [];
            let serverUrl: string | undefined;
            
            // Méthode 1: Chercher les iframes
            const iframes = $("iframe");
            for (let i = 0; i < iframes.length(); i++) {
                const src = iframes.eq(i).attr("src");
                if (src && this.isVideoServer(src, server)) {
                    serverUrl = src;
                    console.log(`✅ Iframe trouvé pour ${server}: ${src}`);
                    break;
                }
            }
            
            // Méthode 2: Chercher dans les boutons de serveur
            if (!serverUrl) {
                const serverButtons = $(`button[data-server*="${server}"], a[data-server*="${server}"]`);
                if (serverButtons.length() > 0) {
                    const dataUrl = serverButtons.first().attr("data-url") || serverButtons.first().attr("data-src");
                    if (dataUrl) {
                        serverUrl = dataUrl;
                        console.log(`✅ URL serveur trouvée dans bouton: ${dataUrl}`);
                    }
                }
            }
            
            // Méthode 3: Chercher dans les scripts
            if (!serverUrl) {
                const scripts = $("script");
                for (let i = 0; i < scripts.length(); i++) {
                    const scriptContent = scripts.eq(i).html();
                    if (scriptContent && scriptContent.includes(server)) {
                        const urlMatches = scriptContent.match(/['"](https?:\/\/[^'"]+)['"]/g);
                        if (urlMatches) {
                            for (const match of urlMatches) {
                                const url = match.replace(/['"]/g, '');
                                if (this.isVideoServer(url, server)) {
                                    serverUrl = url;
                                    console.log(`✅ URL trouvée dans script: ${url}`);
                                    break;
                                }
                            }
                        }
                    }
                    if (serverUrl) break;
                }
            }
            
            // Extraire les sources vidéo
            if (serverUrl) {
                const extracted = await this.extractVideoFromEmbed(serverUrl, server);
                if (extracted.length > 0) {
                    videoSources.push(...extracted);
                } else {
                    // Fallback: retourner l'iframe directement
                    videoSources.push({
                        url: serverUrl,
                        type: "hls" as VideoSourceType,
                        quality: `${server} - Auto`,
                        subtitles: []
                    });
                }
            }
            
            if (videoSources.length > 0) {
                const referer = episode.id.split("/").slice(0, 3).join("/");
                return {
                    headers: {
                        referer: referer,
                        origin: referer
                    },
                    server: server,
                    videoSources: videoSources
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

    //#region Helper Methods

    private isVideoServer(url: string, serverName: string): boolean {
        const lowerUrl = url.toLowerCase();
        const lowerServer = serverName.toLowerCase();
        
        return lowerUrl.includes(lowerServer) ||
               lowerUrl.includes(serverName.replace('stream', '')) ||
               this.getSettings().episodeServers.some(s => lowerUrl.includes(s.toLowerCase()));
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
