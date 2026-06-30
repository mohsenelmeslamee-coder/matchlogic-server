// ✅ TRANSLATION SUPPORT
let currentLanguage = localStorage.getItem("lang") || "ar";

// ✅ XSS PROTECTION: Sanitize any string before injecting into innerHTML.
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ✅ PERFORMANCE: Global DOM refs populated at DOMContentLoaded.
let domMatchesContainer = null;
let domTeamSearchResultsContainer = null;

// ✅ INFINITE SCROLL: Single persistent sentinel - created once, never destroyed.
// Prevents memory leaks from creating/destroying a new observer on every renderMatchesLazy call.
let scrollSentinel = null;
let _sentinelCallback = null;

function initScrollSentinel() {
  if (scrollSentinel) return;
  scrollSentinel = document.createElement('div');
  scrollSentinel.className = 'scroll-sentinel';
  scrollSentinel.style.height = '1px';
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && typeof _sentinelCallback === 'function') {
        _sentinelCallback();
      }
    });
  }, { rootMargin: '150px', threshold: 0.1 });
  obs.observe(scrollSentinel);
}


function getTranslation(key) {
    const translations = {
        ar: {
            loading: 'جاري التحميل...',
            notFound: 'غير موجود',
            error: 'خطأ في التحميل',
            noMatchesFound: 'لا توجد مباريات مطابقة',
            noFavoriteTeams: 'لا توجد فرق مفضلة',
            addFavoriteTeams: 'أضف فرقك المفضلة لرؤية مبارياتها',
            errorLoadingData: 'خطأ في جلب البيانات',
            noTeamsFound: 'لم يتم العثور على فرق',
            comingSoon: 'الإعدادات قريباً',
            teamSearchResults: 'نتائج البحث عن الفرق',
            tryDifferentSearch: 'جرب كلمة بحث مختلفة'
        },
        en: {
            loading: 'Loading...',
            notFound: 'Not Found',
            error: 'Loading Error',
            noMatchesFound: 'No matches found',
            noFavoriteTeams: 'No favorite teams',
            addFavoriteTeams: 'Add your favorite teams to see their matches',
            errorLoadingData: 'Error loading data',
            noTeamsFound: 'No teams found with this name',
            comingSoon: 'Settings coming soon',
            teamSearchResults: 'Team Search Results',
            tryDifferentSearch: 'Try a different search term'
        }
    };
    return translations[currentLanguage]?.[key] || key;
}

// ✅ GOAL DETECTION SYSTEM: Only for favorite teams
let previousScores = new Map(); // matchId -> {home: number, away: number}

function updateGoalDetection(matches) {
    matches.forEach(match => {
        const matchId = match.fixture?.id;
        if (!matchId) return;
        
        const currentScore = {
            home: match.goals?.home || 0,
            away: match.goals?.away || 0
        };
        
        const previousScore = previousScores.get(matchId);
        
        if (previousScore) {
            // Check if score changed (goal scored)
            if (currentScore.home !== previousScore.home || currentScore.away !== previousScore.away) {
                // ✅ ONLY TRIGGER FOR FAVORITE TEAMS
                const favoriteTeams = getFavoriteTeams();
                const homeIsFavorite = favoriteTeams.some(t => t.id === match.teams?.home?.id);
                const awayIsFavorite = favoriteTeams.some(t => t.id === match.teams?.away?.id);
                
                if (homeIsFavorite || awayIsFavorite) {
                    const scorer = currentScore.home > previousScore.home ? match.teams?.home?.name : match.teams?.away?.name;
                    console.log('⚽ GOAL DETECTED for FAVORITE:', scorer, 
                              `${match.teams?.home?.name} ${currentScore.home}-${currentScore.away} ${match.teams?.away?.name}`);
                    
                    // Play goal sound
                    playGoalSound();
                    
                    
                    // Highlight match card
                    highlightMatchCard(matchId);
                } else {
                    console.log('⚽ Goal scored but not a favorite team - no notification');
                }
            }
        }
        
        // Update stored score
        previousScores.set(matchId, currentScore);
    });
}

function playGoalSound() {
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
        audio.volume = 0.3;
        audio.play().catch(() => {}); // Ignore errors
    } catch (e) {
        // Silent fail if audio not supported
    }
}


function highlightMatchCard(matchId) {
    const card = document.querySelector(`[data-match-id="${matchId}"]`);
    if (card) {
        card.classList.add('goal-highlight');
        setTimeout(() => {
            card.classList.remove('goal-highlight');
        }, 3000);
    }
}

// ✅ PROFESSIONAL STATE MANAGEMENT: Separate PAGE from FILTER
let currentPage = "today";     // today, live, favorites
let currentFilter = localStorage.getItem('matchlogic_filter') || "important"; // important, all
let currentPageData = [];
let isLoading = false;
let searchTimeout;
// ✅ currentLanguage already declared above - removing duplicate

// ✅ IMPORTANT LEAGUES DEFINITION
// ✅ IMPORTANT LEAGUES: club leagues + international cups + major national-team tournaments
// IDs verified against api-football.com's official "Leagues & Teams IDs" documentation.
// ⚠️ If any of the newly-added international tournament IDs (Euro, Nations League,
// Copa America, AFCON, Asian Cup, Euro/WC Qualifiers) don't show matches when you'd
// expect them to, double check the exact ID via: /api/leagues?search=<name> on your
// own key — competition IDs can occasionally shift between providers/seasons.
const IMPORTANT_LEAGUES = [
    39, 140, 135, 78, 61, 2, 3, 848, 12, 20, 233, 243, 1, 15, 94, 88, 144, 119, 103,
    // Club leagues/cups (existing): Premier League, La Liga, Serie A, Bundesliga, Ligue 1,
    // Champions League, Europa League, Conference League, CAF Champions League,
    // CAF Confederation Cup, Egyptian Premier League, Egypt Cup, World Cup, Club World Cup,
    // Primeira Liga, Eredivisie, Jupiler Pro League, Superliga, Eliteserien

    // ── Major international NATIONAL TEAM tournaments ──
    4,    // UEFA Euro Championship
    5,    // UEFA Nations League
    9,    // Copa America
    6,    // Africa Cup of Nations (AFCON)
    7,    // Asian Cup
    32,   // World Cup Qualification - Europe
    33,   // World Cup Qualification - South America
    34,   // World Cup Qualification - Africa
    29,   // World Cup Qualification - Asia
    31,   // World Cup Qualification - CONCACAF (North/Central America)
    10,   // Friendlies (international friendlies between national teams)
];

// ✅ LIVE STATUSES DEFINITION
const LIVE_STATUSES = ["1H", "2H", "HT", "ET", "P1", "P2", "LIVE"];

// ✅ CENTRAL FILTER ENGINE: Unified filtering logic
// currentPage is always one of: today / yesterday / tomorrow / favorites / settings
// "Important leagues" and "Live only" are independent toggles (currentFilter, showLiveOnly), not pages.
function getFilteredMatches(matches) {
    if (!matches || matches.length === 0) return [];
    
    let result = matches;

    // ✅ FAVORITES PAGE: only matches involving a favorite team
    if (currentPage === "favorites") {
        const favoriteTeams = getFavoriteTeams();
        const favoriteIds = favoriteTeams.map(t => t.id);
        result = result.filter(m => {
            const homeId = m?.teams?.home?.id;
            const awayId = m?.teams?.away?.id;
            return favoriteIds.includes(homeId) || favoriteIds.includes(awayId);
        });
    }

    // ✅ LIVE-ONLY TOGGLE: takes priority over the important-leagues filter
    if (showLiveOnly) {
        result = result.filter(m => LIVE_STATUSES.includes(m?.fixture?.status?.short));
        return result;
    }

    // ✅ IMPORTANT LEAGUES TOGGLE: button only visible on 'today' page, so only apply there
    if (currentFilter === "important" && currentPage === "today") {
        result = result.filter(m => IMPORTANT_LEAGUES.includes(m?.league?.id));
    }

    return result;
}

// ✅ ROBUST PAGE TOGGLE: Never shows empty screen
function togglePageMode(clickedPage) {
    console.log(`🔄 Toggling page mode: ${currentPage} -> ${clickedPage}`);
    
    // Toggle logic: Reset to today if clicking same page twice
    if (clickedPage === currentPage) {
        currentPage = "today"; // Reset to default
    } else {
        currentPage = clickedPage;
    }
    
    // Always render using current data
    displayMatches(currentPageData);
}

// ✅ FILTER TOGGLE: Important vs All
function toggleFilter() {
    currentFilter = currentFilter === "important" ? "all" : "important";
    localStorage.setItem('matchlogic_filter', currentFilter);
    console.log(`🔄 Toggling filter: ${currentFilter}`);
    
    // ✅ UPDATE BUTTON TEXT DYNAMICALLY
    const filterBtn = document.getElementById('toggleFilterBtn');
    if (filterBtn) {
        if (currentFilter === 'important') {
            filterBtn.textContent = currentLanguage === 'ar' ? 'أهم المباريات 🔥' : 'Important Matches 🔥';
        } else {
            filterBtn.textContent = currentLanguage === 'ar' ? 'كل المباريات 📋' : 'All Matches 📋';
        }
    }
    
    // Always render using current data
    displayMatches(currentPageData);
}

window.toggleFilter = toggleFilter;

// ✅ LANGUAGE SYSTEM: Show modal on first visit
function initializeLanguage() {
    if (!localStorage.getItem("lang")) {
        showLanguageModal();
        return false; // Don't initialize app yet
    }
    return true; // Language set, can initialize app
}

function showLanguageModal() {
    const modal = document.createElement('div');
    modal.className = 'language-modal';
    modal.innerHTML = `
        <div class="language-modal-content">
            <div class="language-modal-icon">🌐</div>
            <h2>اختر اللغة<br><span class="lang-modal-sub">Choose Your Language</span></h2>
            <div class="language-buttons">
                <button id="btn-ar" class="lang-btn">
                    <span class="flag">🇸🇦</span>
                    <span>العربية</span>
                </button>
                <button id="btn-en" class="lang-btn">
                    <span class="flag">🇬🇧</span>
                    <span>English</span>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden'; // Prevent scrolling
    
    // ✅ CSP-COMPLIANT: Add event listeners instead of onclick
    document.getElementById('btn-ar').addEventListener('click', () => setLanguage('ar'));
    document.getElementById('btn-en').addEventListener('click', () => setLanguage('en'));
}

function setLanguage(lang) {
    localStorage.setItem("lang", lang);
    currentLanguage = lang;
    
    // ✅ DOCUMENT DIRECTION: Set language and direction
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    
    // Remove modal
    const modal = document.querySelector('.language-modal');
    if (modal) {
        modal.remove();
        document.body.style.overflow = ''; // Restore scrolling
        // ✅ MODAL CONTEXT: Initialize app after modal selection
        initializeApp();
    } else {
        // ✅ SETTINGS CONTEXT: Refresh UI without full reinitialization
        loadSettingsPage();
        
        // ✅ UPDATE SEARCH PLACEHOLDER: Manually update to new language
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.placeholder = currentLanguage === 'ar' ? 'ابحث عن فريق أو دوري...' : 'Search for a team or league...';
        }
        
        // ✅ UPDATE NAVIGATION TEXT: Update all tab texts
        const tabTranslations = {
            todayTab: currentLanguage === 'ar' ? 'اليوم' : 'Today',
            yesterdayTab: currentLanguage === 'ar' ? 'الأمس' : 'Yesterday',
            tomorrowTab: currentLanguage === 'ar' ? 'الغد' : 'Tomorrow',
            favoritesTab: currentLanguage === 'ar' ? '⭐ المفضلة' : '⭐ Favorites',
            settingsTab: currentLanguage === 'ar' ? '⚙ الإعدادات' : '⚙ Settings'
        };
        
        Object.entries(tabTranslations).forEach(([tabId, text]) => {
            const tab = document.getElementById(tabId);
            if (tab) tab.textContent = text;
        });
        
        // ✅ UPDATE BUTTON TEXTS: Update filter buttons
        const toggleFilterBtn = document.getElementById('toggleFilterBtn');
        if (toggleFilterBtn) {
            toggleFilterBtn.textContent = currentFilter === 'important' ? 
                (currentLanguage === 'ar' ? 'أهم المباريات 🔥' : 'Important 🔥') :
                (currentLanguage === 'ar' ? 'جميع المباريات 📊' : 'All Matches 📊');
        }
        
        const liveFilterBtn = document.getElementById('liveFilterBtn');
        if (liveFilterBtn) {
            liveFilterBtn.textContent = currentLanguage === 'ar' ? 'مباشر الآن ⚡' : 'Live Now ⚡';
        }

        // ℹ️ No need to re-render match cards here: the user is looking at the
        // Settings page right now (cards aren't on screen). The next time they
        // open any tab, changePage() calls loadXxxMatches() → displayMatches()
        // fresh, which already reads the now-updated currentLanguage correctly.
    }
}

// ✅ EXPORT LANGUAGE FUNCTIONS
window.setLanguage = setLanguage;

// ✅ SMART CACHE DURATIONS (API PROTECTION)
// Client-side caching prevents excessive API calls and protects rate limits
// Different cache durations based on match status
const CACHE_DURATIONS = {
    live: 30 * 1000,        // 30 seconds for live matches
    today: 2 * 60 * 1000,    // 2 minutes for today matches
    finished: 10 * 60 * 1000, // 10 minutes for finished matches
    default: 5 * 60 * 1000   // 5 minutes default
};
let dataCache = {};

function getCachedApiResponse(url) {
    const entry = dataCache[url];
    if (!entry) return null;
    const duration = entry.cacheType ? CACHE_DURATIONS[entry.cacheType] || CACHE_DURATIONS.default : CACHE_DURATIONS.default;
    if (Date.now() - entry.timestamp > duration) {
        delete dataCache[url];
        return null;
    }
    return entry.data;
}

function setCachedApiResponse(url, data, cacheType = 'default') {
    dataCache[url] = { data, timestamp: Date.now(), cacheType };
}

function clearExpiredCache() {
    Object.keys(dataCache).forEach(url => {
        const entry = dataCache[url];
        const duration = entry.cacheType ? CACHE_DURATIONS[entry.cacheType] || CACHE_DURATIONS.default : CACHE_DURATIONS.default;
        if (Date.now() - entry.timestamp > duration) {
            delete dataCache[url];
        }
    });
}

// ✅ ENHANCED FAVORITES SYSTEM: Support Teams + Leagues
function getFavorites() {
    try {
        const data = localStorage.getItem("matchlogic_favorites");
        return data ? JSON.parse(data) : {teams:[],leagues:[]};
    } catch (error) {
        console.error('❌ Error parsing favorites:', error);
        return {teams:[],leagues:[]};
    }
}

function saveFavorites(favorites) {
    localStorage.setItem("matchlogic_favorites", JSON.stringify(favorites));
}

function getFavoriteTeams() {
    const favorites = getFavorites();
    return favorites.teams || [];
}

function getFavoriteLeagues() {
    const favorites = getFavorites();
    return favorites.leagues || [];
}

function toggleFavoriteTeam(teamId, teamName, teamLogo) {
    const favorites = getFavorites();
    const teamIndex = favorites.teams.findIndex(t => t.id === teamId);
    
    if (teamIndex > -1) {
        // Remove from favorites
        favorites.teams.splice(teamIndex, 1);
        console.log(`💔 Removed ${teamName} from favorites`);
        showToast(currentLanguage === 'ar' ? `تمت إزالة ${teamName} من المفضلة` : `${teamName} removed from favorites`);
    } else {
        // Add to favorites
        favorites.teams.push({ id: teamId, name: teamName, logo: teamLogo });
        console.log(`❤️ Added ${teamName} to favorites`);
        showToast(currentLanguage === 'ar' ? `تمت إضافة ${teamName} إلى المفضلة` : `${teamName} added to favorites`);
    }
    
    saveFavorites(favorites);
    
    // ✅ DYNAMIC UI UPDATE: Toggle favorite buttons without page refresh
    const isFavorited = teamIndex > -1;
    const favoriteButtons = document.querySelectorAll(`[data-team-id="${teamId}"]`);
    favoriteButtons.forEach(button => {
        if (isFavorited) {
            button.classList.remove('favorited');
            button.textContent = '☆';
        } else {
            button.classList.add('favorited');
            button.textContent = '⭐';
        }
    });
}

// ✅ FEEDBACK SYSTEM: Toast notifications for user actions
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    
    // ✅ RELY 100% ON CSS CLASS - no inline styles
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 2000);
}

function toggleFavoriteLeague(leagueId, leagueName) {
    const favorites = getFavorites();
    const leagueIndex = favorites.leagues.findIndex(l => l.id === leagueId);
    
    if (leagueIndex > -1) {
        // Remove from favorites
        favorites.leagues.splice(leagueIndex, 1);
        console.log(`💔 Removed ${leagueName} from favorite leagues`);
    } else {
        // Add to favorites
        favorites.leagues.push({ id: leagueId, name: leagueName });
        console.log(`❤️ Added ${leagueName} to favorite leagues`);
    }
    
    saveFavorites(favorites);
}

// ✅ USER TIMEZONE: Automatic detection
const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function formatMatchDateTime(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleString(currentLanguage === 'ar' ? 'ar-SA' : 'en-US', {
            timeZone: userTimeZone,
            hour: '2-digit',
            minute: '2-digit',
            day: 'numeric',
            month: 'short'
        });
    } catch (error) {
        console.error('Error formatting date:', error);
        return dateString;
    }
}

// ✅ UTILITY
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// ✅ REQUEST DEDUPLICATION: Prevent multiple parallel requests
const pendingRequests = new Map();

async function fetchWithErrorDeduplication(url, options = {}) {
    // Check if request is already pending
    if (pendingRequests.has(url)) {
        console.log('🔄 Reusing pending request:', url);
        return await pendingRequests.get(url);
    }
    
    // Create new request
    const requestPromise = fetchWithErrorHandling(url, options);
    pendingRequests.set(url, requestPromise);
    
    try {
        const result = await requestPromise;
        return result;
    } finally {
        // Clean up pending request
        pendingRequests.delete(url);
    }
}
const PRIORITY_TEAM_MAPPINGS = {
    // ── Egypt ──
    'اهلي': ['Al Ahly', 'Ahly'], 'الاهلي': ['Al Ahly', 'Ahly'],
    'زمالك': ['Zamalek'], 'الزمالك': ['Zamalek'],
    'بيراميدز': ['Pyramids'],
    'انبي': ['ENPPI'],
    'مصري': ['Al Masry'], 'المصري': ['Al Masry'],

    // ── Saudi Arabia ──
    'نصر': ['Al Nassr'], 'النصر': ['Al Nassr'],
    'هلال': ['Al Hilal'], 'الهلال': ['Al Hilal'],
    'اتحاد': ['Al Ittihad'], 'الاتحاد': ['Al Ittihad'],
    'احد': ['Al Ahli Saudi', 'Al-Ahli'], 'الاهلي السعودي': ['Al Ahli Saudi', 'Al-Ahli'],

    // ── England ──
    'ليفربول': ['Liverpool'],
    'مانشستر يونايتد': ['Manchester United'], 'مانشستر يونايتد': ['Manchester United'], 'يونايتد': ['Manchester United'],
    'مانشستر سيتي': ['Manchester City'], 'مان سيتي': ['Manchester City'], 'سيتي': ['Manchester City'],
    'تشيلسي': ['Chelsea'],
    'ارسنال': ['Arsenal'],
    'توتنهام': ['Tottenham'],
    'نيوكاسل': ['Newcastle'],
    'استون فيلا': ['Aston Villa'],
    'وست هام': ['West Ham'],
    'ايفرتون': ['Everton'],
    'ليستر': ['Leicester'],

    // ── Spain ──
    'ريال مدريد': ['Real Madrid'],
    'برشلونة': ['Barcelona'], 'برشلونه': ['Barcelona'],
    'اتلتيكو مدريد': ['Atletico Madrid'], 'اتليتكو مدريد': ['Atletico Madrid'],
    'اشبيلية': ['Sevilla'],
    'فالنسيا': ['Valencia'],
    'ريال سوسيداد': ['Real Sociedad'],
    'ريال بيتيس': ['Real Betis'],

    // ── Italy ──
    'يوفنتوس': ['Juventus'],
    'انتر ميلان': ['Inter'], 'انتر': ['Inter'],
    'ميلان': ['AC Milan', 'Milan'],
    'نابولي': ['Napoli'],
    'روما': ['Roma', 'AS Roma'],
    'لاتسيو': ['Lazio'],
    'اتلانتا': ['Atalanta'],

    // ── Germany ──
    'بايرن ميونخ': ['Bayern Munich'], 'بايرن': ['Bayern Munich'],
    'بوروسيا دورتموند': ['Borussia Dortmund'], 'دورتموند': ['Borussia Dortmund'],
    'لايبزيغ': ['RB Leipzig'],
    'باير ليفركوزن': ['Bayer Leverkusen'], 'ليفركوزن': ['Bayer Leverkusen'],

    // ── France ──
    'باريس سان جيرمان': ['Paris Saint Germain', 'PSG'], 'سان جيرمان': ['Paris Saint Germain', 'PSG'],
    'مارسيليا': ['Marseille'],
    'ليون': ['Lyon'],
    'موناكو': ['Monaco'],

    // ── Portugal / Netherlands ──
    'بورتو': ['Porto'],
    'بنفيكا': ['Benfica'],
    'اياكس': ['Ajax'],

    // ── National teams ──
    'مصر': ['Egypt'],
    'السعودية': ['Saudi Arabia'],
    'البرازيل': ['Brazil'],
    'الارجنتين': ['Argentina'],
    'فرنسا': ['France'],
    'انجلترا': ['England'],
    'اسبانيا': ['Spain'],
    'المانيا': ['Germany'],
    'البرتغال': ['Portugal'],
    'ايطاليا': ['Italy'],
    'المغرب': ['Morocco'],
    'الجزائر': ['Algeria'],
    'تونس': ['Tunisia'],
};

function normalizeArabic(text) {
    if (!text) return '';
    return text.replace(/[أإآ]/g, 'ا').replace(/[ى]/g, 'ي').replace(/[\u064B-\u0652\u0670\u0640]/g, '');
}

function stripPrefix(text) {
    if (!text) return '';
    return text.replace(/^ال/, '').replace(/^Al\s+/i, '').trim();
}

function searchTeam(query, teamName) {
    if (!query || !teamName) return false;
    const normalizedSearch = stripPrefix(normalizeArabic(query));
    const normalizedTeam = normalizeArabic(teamName);

    if (PRIORITY_TEAM_MAPPINGS[normalizedSearch]) {
        if (PRIORITY_TEAM_MAPPINGS[normalizedSearch].some(m => teamName.toLowerCase().includes(m.toLowerCase())))
            return true;
    }

    return normalizedTeam.includes(normalizedSearch) || 
           stripPrefix(teamName.toLowerCase()).includes(stripPrefix(query.toLowerCase())) ||
           teamName.toLowerCase().includes(query.toLowerCase());
}

let searchQuery = '';
let showLiveOnly = false;
// ✅ currentFilter already declared above - removing duplicate

function sanitizeSearchQuery(query) {
    if (!query || typeof query !== 'string') return '';
    return query.normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^\w\s\u0600-\u06FF-]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
}

// ✅ ENHANCED SEARCH ENGINE: Support Arabic and English
function normalizeText(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[\u064B-\u065F]/g, "") // Remove Arabic diacritics
        .trim();
}

function searchMatches(query) {
    if (!query || query.length < 2) return currentPageData;
    
    const normalizedQuery = normalizeText(query);
    
    return currentPageData.filter(match => {
        // ✅ USE searchTeam() FOR ARABIC DICTIONARY MATCHING
        const homeTeam = match.teams?.home?.name || '';
        const awayTeam = match.teams?.away?.name || '';
        const league = match.league?.name || '';
        
        // Search with prioritized Arabic mapping
        return searchTeam(normalizedQuery, homeTeam) || 
               searchTeam(normalizedQuery, awayTeam) || 
               searchTeam(normalizedQuery, league);
    });
}

const debouncedSearch = debounce((query) => {
    const rawQuery = normalizeText(decodeURIComponent(query));
    searchQuery = sanitizeSearchQuery(rawQuery);

    hideLoadingOverlay();

    const container = document.getElementById("matchesContainer");
    if (!container) return;

    // ✅ FAVORITES PAGE: search filters within favorite teams' matches only,
    // and must not destroy the favorites header (search box + team chips).
    if (currentPage === 'favorites') {
        if (!searchQuery || searchQuery.length === 0) {
            displayFavoritesMatches();
            return;
        }
        searchWithinFavorites(searchQuery);
        return;
    }

    // ✅ SEARCH RESET GUARD: Properly handle empty queries
    if (!searchQuery || searchQuery.length === 0) {
        displayMatches(currentPageData);
        return;
    }

    const searchResults = searchMatches(searchQuery);

    if (searchResults.length > 0) {
        renderMatchesLazy(searchResults, container);
        console.log(`🔍 Found ${searchResults.length} matches for "${searchQuery}"`);
    } else {
        container.innerHTML = `<div class="empty-state">
            <h3>${getTranslation('noMatchesFound')}</h3>
            <p>${getTranslation('tryDifferentSearch')}</p>
        </div>`;
    }
}, 300);

// ✅ SEARCH WITHIN FAVORITE TEAMS' MATCHES — keeps favorites header intact
async function searchWithinFavorites(query) {
    const favorites = getFavoriteTeams();
    const favoriteIds = favorites.map(t => t.id);

    const today = getLocalDate(0);
    let cachedData = getCachedApiResponse(`matches-${today}`);
    let allMatches = cachedData?.response || [];

    if (allMatches.length === 0) {
        try {
            const response = await fetch(`/api/matches?date=${today}`);
            const data = await response.json();
            allMatches = data?.response || [];
            setCachedApiResponse(`matches-${today}`, data, 'today');
        } catch (e) {
            console.error('❌ Error fetching matches for favorites search:', e);
        }
    }

    const favoriteMatches = allMatches.filter(m => {
        const homeId = m?.teams?.home?.id;
        const awayId = m?.teams?.away?.id;
        return favoriteIds.includes(homeId) || favoriteIds.includes(awayId);
    });

    const filtered = favoriteMatches.filter(match => {
        const homeTeam = match.teams?.home?.name || '';
        const awayTeam = match.teams?.away?.name || '';
        const league = match.league?.name || '';
        return searchTeam(query, homeTeam) || searchTeam(query, awayTeam) || searchTeam(query, league);
    });

    // ✅ ONLY replace the matches sub-container, never the favorites header
    let matchesWrap = document.querySelector('#matchesContainer .favorites-matches-wrap');
    if (!matchesWrap) {
        matchesWrap = document.createElement('div');
        matchesWrap.className = 'matches favorites-matches-wrap';
        document.getElementById('matchesContainer').appendChild(matchesWrap);
    }

    if (filtered.length > 0) {
        renderMatchesLazy(filtered, matchesWrap);
    } else {
        matchesWrap.innerHTML = `<div class="empty-state">
            <h3>${getTranslation('noMatchesFound')}</h3>
            <p>${getTranslation('tryDifferentSearch')}</p>
        </div>`;
    }
}

// ✅ GLOBAL TEAM SEARCH FOR FAVORITES
async function searchTeamsForFavorites(query) {
    if (!query || query.length === 0) return [];
    
    try {
        showLoadingOverlay();
        const res = await fetch(`/api/teams/search?q=${encodeURIComponent(query)}`);
        if (!res) return [];
        
        const data = await res.json();
        hideLoadingOverlay();
        return data.response || [];
    } catch (error) {
        console.error('❌ Error searching teams:', error);
        hideLoadingOverlay();
        return [];
    }
}

// ✅ RENDER TEAM SEARCH RESULTS WITH FAVORITE BUTTONS
function renderTeamSearchResults(teams) {
    const container = document.getElementById("teamSearchResultsContainer");
    if (!container) return;
    
    const favoriteTeams = getFavoriteTeams();
    const favoriteIds = favoriteTeams.map(t => t.id);
    
    const teamsHTML = teams.map(team => {
        const isFavorite = favoriteIds.includes(team.team.id);
        return `
            <div class="team-search-result" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 15px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <img src="${team.team.logo}" alt="${team.team.name}" style="width: 40px; height: 40px; object-fit: contain;" onerror="handleImageError(this)" />
                    <div>
                        <h4 style="margin: 0; color: var(--text-main); font-size: 16px;">${team.team.name}</h4>
                        <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 14px;">${team.league || 'Global Search'}</p>
                    </div>
                </div>
                <button onclick="toggleFavoriteTeam(${team.team.id}, '${team.team.name.replace(/'/g, "\\'")}', '${team.team.logo}')" 
                        class="favorite-btn ${isFavorite ? 'favorited' : ''}" 
                        style="background: none; border: none; font-size: 24px; cursor: pointer; padding: 5px;">
                    ${isFavorite ? '⭐' : '➕'}
                </button>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `
        <div class="search-results-header" style="margin-bottom: 20px;">
            <h3 style="color: var(--text-main); margin-bottom: 10px;">${getTranslation('teamSearchResults')}</h3>
            <button onclick="clearTeamSearch()" style="padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer;">
                ${currentLanguage === 'ar' ? 'مسح البحث' : 'Clear Search'}
            </button>
        </div>
        ${teamsHTML}
    `;
}

// ✅ CLEAR TEAM SEARCH
function clearTeamSearch() {
    const container = document.getElementById("teamSearchResultsContainer");
    if (container) {
        container.innerHTML = '';
    }
    const searchInput = document.getElementById('favoritesSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }
}

// ✅ SEARCH GLOBAL TEAMS (updated for favorites)
async function searchGlobalTeams(query) {
    if (!query || query.length === 0) return;
    
    const teams = await searchTeamsForFavorites(query);
    if (teams.length > 0) {
        renderTeamSearchResults(teams);
        console.log(`🌍 Found ${teams.length} teams for "${query}"`);
    } else {
        // ✅ TARGET SEARCH CONTAINER FIRST, FALLBACK TO MATCHES CONTAINER
        let container = document.getElementById("teamSearchResultsContainer");
        if (!container) {
            container = document.getElementById("matchesContainer");
        }
        if (container) {
            container.innerHTML = `<div class="empty-state">
                <h3>${getTranslation('noTeamsFound')}</h3>
                <p>${currentLanguage === 'ar' ? 'لم يتم العثور على فرق بهذا الاسم' : 'No teams found with this name'}</p>
            </div>`;
        }
    }
}

// ✅ FETCH WITH IMPROVED ERROR HANDLING (RATE LIMIT PROTECTION)
// Always check cache before making API requests to protect the API key
// Handle 429 (rate limit) errors gracefully
async function fetchWithErrorHandling(url, options = {}) {
    try {
        const res = await fetch(url, options);
        if (res.status === 429) { showSmartError('rate_limit'); return null; }
        // ✅ OFFLINE DETECTION: Service worker returns 503 with {error:'Offline'}
        // when there's no network. Distinguish this from real server errors.
        if (res.status === 503) {
            try {
                const body = await res.clone().json();
                if (body?.error === 'Offline') { showSmartError('network_error'); return null; }
            } catch (_) { /* body not JSON, fall through */ }
            showSmartError('server_error'); return null;
        }
        if (res.status >= 500) { showSmartError('server_error'); return null; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    } catch (err) {
        console.error('Network error:', err);
        showSmartError('network_error');
        return null;
    }
}

// ✅ DISPLAY MATCHES: ALWAYS use central filter engine
function displayMatches(matches, pageType) {
    const container = document.getElementById("matchesContainer");
    if (!container) {
        console.error('❌ matchesContainer not found!');
        return;
    }

    // ✅ LIVE FILTER PRIORITY: Apply live filter before important leagues filter
    const filtered = getFilteredMatches(matches);
    
    // ✅ SHOW FRIENDLY MESSAGE FOR EMPTY RESULTS - NEVER EMPTY CONTAINER
    if (filtered.length === 0) {
        let emptyMessage = getTranslation('noMatchesFound');
        let emptyDescription = '';
        
        if (currentPage === "today") {
            emptyMessage = currentLanguage === 'ar' ? 'لا توجد مباريات اليوم' : 'No matches today';
            emptyDescription = currentLanguage === 'ar' ? 'جرب التحقق من تواريخ أخرى' : 'Try checking other dates';
        } else if (currentPage === "important") {
            emptyMessage = currentLanguage === 'ar' ? 'لا توجد مباريات في الدوريات المهمة اليوم' : 'No important league matches today';
            emptyDescription = currentLanguage === 'ar' ? 'جرب عرض جميع المباريات' : 'Try viewing all matches';
        } else if (currentPage === "live") {
            emptyMessage = currentLanguage === 'ar' ? 'لا توجد مباريات مباشرة حالياً' : 'No live matches currently';
            emptyDescription = currentLanguage === 'ar' ? 'جرب التحقق لاحقاً' : 'Try checking later';
        } else if (currentPage === "favorites") {
            emptyMessage = currentLanguage === 'ar' ? 'لا توجد مباريات للفرق المفضلة' : 'No matches for favorite teams';
            emptyDescription = currentLanguage === 'ar' ? 'أضف فرق مفضلة لرؤية مبارياتها' : 'Add favorite teams to see their matches';
        } else if (currentPage === "tomorrow") {
            emptyMessage = currentLanguage === 'ar' ? 'لا توجد مباريات مجدولة غداً' : 'No matches scheduled tomorrow';
            emptyDescription = currentLanguage === 'ar' ? 'جرب التحقق لاحقاً' : 'Try checking later';
        } else if (currentPage === "yesterday") {
            emptyMessage = currentLanguage === 'ar' ? 'لا توجد مباريات من الأمس' : 'No matches from yesterday';
            emptyDescription = '';
        }
        
        container.innerHTML = `<div class="empty-state">
            <h3>${emptyMessage}</h3>
            <p>${emptyDescription}</p>
        </div>`;
        
        console.log(`📄 Empty state for page: ${currentPage}, filter: ${currentFilter}`);
        return;
    }

    renderMatchesLazy(filtered, container);
    console.log(`🎯 Started lazy rendering for ${filtered.length} matches (page: ${currentPage}, filter: ${currentFilter})`);
    
    // ✅ GOAL DETECTION: Check for goals in new data
    updateGoalDetection(filtered);
}

// ✅ LAZY RENDERING: Render only first 20 matches initially
let renderedMatchesCount = 0;
const MATCHES_PER_PAGE = 20;

// ✅ PERFORMANCE: Lazy loading with single persistent sentinel (no memory leak).
// The IntersectionObserver lives in initScrollSentinel() at top of file.

function setupIntersectionObserver(container, allMatches) {
    _sentinelCallback = () => loadMoreMatches(allMatches, container);
}

function renderMatchesLazy(list, container) {
    const initialMatches = list.slice(0, MATCHES_PER_PAGE);
    renderMatches(initialMatches, container);
    renderedMatchesCount = initialMatches.length;

    setupIntersectionObserver(container, list);

    // Move the single persistent sentinel to the bottom of this container
    if (scrollSentinel && !container.contains(scrollSentinel)) {
        container.appendChild(scrollSentinel);
    }

    console.log(`Started lazy rendering for ${list.length} matches (single-sentinel observer)`);
}

function loadMoreMatches(allMatches, container) {
    if (renderedMatchesCount >= allMatches.length) return;
    
    const nextMatches = allMatches.slice(renderedMatchesCount, renderedMatchesCount + MATCHES_PER_PAGE);
    const fragment = document.createDocumentFragment();
    
    // ✅ PERFORMANCE: Get favorite teams ONCE outside the loop
    const favoriteTeams = getFavoriteTeams();
    
    nextMatches.forEach(match => {
        const card = createMatchCard(match, favoriteTeams);
        if (card) fragment.appendChild(card);
    });
    
    // Insert before the persistent sentinel so it stays at the bottom
    if (scrollSentinel && container.contains(scrollSentinel)) {
        container.insertBefore(fragment, scrollSentinel);
    } else {
        container.appendChild(fragment);
    }

    renderedMatchesCount += nextMatches.length;
    console.log(`Loaded ${renderedMatchesCount}/${allMatches.length} matches`);
    // Single persistent observer - no re-observe needed
}

function createMatchCard(match, favoriteTeams) {
    if (!match?.teams?.home || !match?.teams?.away) return null;
    const status = getMatchStatus(match, currentPage);
    if (!status.isValid) return null;

    // Check if teams are favorites using passed favoriteTeams
    const homeIsFavorite = favoriteTeams.some(t => t.id === match.teams.home.id);
    const awayIsFavorite = favoriteTeams.some(t => t.id === match.teams.away.id);

    const card = document.createElement("div");
    card.className = "match-card";
    card.dataset.matchId = match.fixture?.id || '';
    card.innerHTML = `
        <div class="match-header">
            <div class="league-info">
                <span class="league-name">${escapeHTML(match.league?.name || '')}</span>
            </div>
        </div>
        <div class="match-row">
            <div class="team">
                <img src="${escapeHTML(match.teams.home.logo)}" alt="logo" onerror="handleImageError(this)" />
                <span>${escapeHTML(match.teams.home.name)}</span>
                <button class="favorite-btn ${homeIsFavorite ? 'favorited' : ''}" 
                        data-team-id="${match.teams.home.id}"
                        id="fav-home-${match.fixture.id}-${match.teams.home.id}"
                        aria-label="${homeIsFavorite ? 'إزالة ' + escapeHTML(match.teams.home.name) + ' من المفضلة' : 'إضافة ' + escapeHTML(match.teams.home.name) + ' إلى المفضلة'}">
                    ${homeIsFavorite ? '⭐' : '☆'}
                </button>
            </div>
            <div class="score ${match.fixture?.status?.short === '1H' || match.fixture?.status?.short === '2H' || match.fixture?.status?.short === 'ET' || match.fixture?.status?.short === 'P' ? 'live' : ''}">
                ${status.scoreHtml}
                <div class="${status.statusClass}">${status.statusText}</div>
            </div>
            <div class="team away-team">
                <button class="favorite-btn ${awayIsFavorite ? 'favorited' : ''}" 
                        data-team-id="${match.teams.away.id}"
                        id="fav-away-${match.fixture.id}-${match.teams.away.id}"
                        aria-label="${awayIsFavorite ? 'إزالة ' + escapeHTML(match.teams.away.name) + ' من المفضلة' : 'إضافة ' + escapeHTML(match.teams.away.name) + ' إلى المفضلة'}">
                    ${awayIsFavorite ? '⭐' : '☆'}
                </button>
                <span>${escapeHTML(match.teams.away.name)}</span>
                <img src="${escapeHTML(match.teams.away.logo)}" alt="logo" onerror="handleImageError(this)" />
            </div>
        </div>
        <div class="ai-analysis-section">
            ${getAIAnalysisHTML(match)}
        </div>
    `;

    // ✅ CSP-COMPLIANT: Add event listeners using card.querySelector for safety
    const homeFavBtn = card.querySelector(`#fav-home-${match.fixture.id}-${match.teams.home.id}`);
    if (homeFavBtn) {
        homeFavBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavoriteTeam(match.teams.home.id, match.teams.home.name, match.teams.home.logo);
        });
    }
    
    const awayFavBtn = card.querySelector(`#fav-away-${match.fixture.id}-${match.teams.away.id}`);
    if (awayFavBtn) {
        awayFavBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavoriteTeam(match.teams.away.id, match.teams.away.name, match.teams.away.logo);
        });
    }

    // ✅ PERFORMANCE: Use addEventListener for CSP compliance
    card.addEventListener('click', () => {
        if (match.fixture?.id) window.location.href = `match.html?id=${match.fixture.id}`;
    });

    const aiBtn = card.querySelector('.ai-analysis-btn');
    if (aiBtn) {
        aiBtn.addEventListener('click', e => { 
            e.stopPropagation(); 
            // ✅ tab=ai param → match.js reads it and calls setActiveTab('ai') directly
            window.location.href = `match.html?id=${match.fixture?.id}&tab=ai`;
        });
    }

    return card;
}
function renderMatches(list, container) {
    container.innerHTML = '';
    
    // ✅ PERFORMANCE: Get favorite teams ONCE outside the loop
    const favoriteTeams = getFavoriteTeams();
    
    list.forEach(match => {
        const card = createMatchCard(match, favoriteTeams);
        if (card) container.appendChild(card);
    });
}

function getAIAnalysisHTML(match) {
    const statusShort = match.fixture?.status?.short;
    const finished = ["FT","AET","PEN"].includes(statusShort);
    if (finished) return `<div class="ai-analysis-disabled">🤖 ${currentLanguage==='ar'?'المباراة انتهت. التحليل متاح للمباريات القادمة والمباشرة.':'Match finished. Analysis available for upcoming/live matches.'}</div>`;
    return `<button class="ai-analysis-btn">🤖 ${currentLanguage==='ar'?'تحليل المباراة':'Match Analysis'}</button>`;
}

// ✅ PAGE NAVIGATION: Handle page changes with active class management
function changePage(page) {
    currentPage = page;
    console.log(`📄 Changing to page: ${page}`);
    
    // Update active tab styling
    updateActiveTab(page);
    
    // ✅ DYNAMIC PLACEHOLDER: Clarify search scope per page
    const mainSearchInput = document.getElementById('searchInput');
    if (mainSearchInput) {
        mainSearchInput.value = '';
        if (page === 'favorites') {
            mainSearchInput.placeholder = currentLanguage === 'ar'
                ? 'فلترة مباريات فرقك المفضلة...'
                : 'Filter your favorite teams\' matches...';
        } else {
            mainSearchInput.placeholder = currentLanguage === 'ar'
                ? 'ابحث عن فريق أو دوري...'
                : 'Search for a team or league...';
        }
    }
    searchQuery = '';
    
    // Search stays visible on every page except settings (settings = language only)
    const controlsSection = document.querySelector('.controls-section');
    if (controlsSection) {
        if (page === 'settings') {
            controlsSection.style.display = 'none';
        } else {
            controlsSection.style.display = 'flex';
            const toggleFilterBtn = document.getElementById('toggleFilterBtn');
            if (toggleFilterBtn) {
                if (page === 'tomorrow' || page === 'yesterday' || page === 'favorites') {
                    toggleFilterBtn.style.display = 'none';
                } else {
                    toggleFilterBtn.style.display = '';
                }
            }
            
            // ✅ LIVE FILTER UI: Show/hide live filter button
            const liveFilterBtn = document.getElementById('liveFilterBtn');
            if (liveFilterBtn) {
                if (page === 'today') {
                    liveFilterBtn.classList.remove('hidden');
                } else {
                    liveFilterBtn.classList.add('hidden');
                    // ✅ RESET LIVE FILTER: Reset when leaving today page
                    showLiveOnly = false;
                    liveFilterBtn.style.background = 'var(--bg-elevated)';
                    liveFilterBtn.style.color = 'var(--text-main)';
                }
            }
        }
    }
    
    // Load data based on page
    switch(page) {
        case 'today':
            loadTodayMatches();
            break;
        case 'yesterday':
            loadYesterdayMatches();
            break;
        case 'tomorrow':
            loadTomorrowMatches();
            break;
        case 'favorites':
            loadFavoritesPage();
            break;
        case 'settings':
            loadSettingsPage();
            break;
        default:
            loadTodayMatches();
    }
}

// ✅ UPDATE ACTIVE TAB STYLING
function updateActiveTab(activePage) {
    const tabs = document.querySelectorAll('.tabs button');
    tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.getAttribute('onclick')?.includes(activePage) || 
            tab.getAttribute('data-page') === activePage) {
            tab.classList.add('active');
        }
    });
}

// ✅ LOAD SETTINGS PAGE — Language selection only
function loadSettingsPage() {
    const container = document.getElementById("matchesContainer");
    if (!container) return;

    container.innerHTML = `
        <div class="settings-page">
            <div class="settings-section">
                <div class="settings-section-title">
                    <span class="settings-icon">🌐</span>
                    <h3>${currentLanguage === 'ar' ? 'اللغة' : 'Language'}</h3>
                </div>
                <p class="settings-desc">${currentLanguage === 'ar' ? 'اختر لغة عرض الموقع' : 'Choose the site display language'}</p>
                <div class="settings-lang-row">
                    <button class="settings-lang-btn ${currentLanguage === 'ar' ? 'active' : ''}" data-lang="ar">
                        <span>🇸🇦</span> العربية
                    </button>
                    <button class="settings-lang-btn ${currentLanguage === 'en' ? 'active' : ''}" data-lang="en">
                        <span>🇬🇧</span> English
                    </button>
                </div>
            </div>
        </div>
    `;

    container.querySelectorAll('.settings-lang-btn').forEach(btn => {
        btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
    });
}

// ✅ CLEAR ALL CACHE WITH RATE-LIMIT
function clearAllCache() {
    // ✅ RATE-LIMIT: Check 5-minute cooldown
    const lastClear = localStorage.getItem('matchlogic_last_cache_clear');
    const now = Date.now();
    const cooldownMs = 300000; // 5 minutes
    
    if (lastClear && (now - parseInt(lastClear)) < cooldownMs) {
        const remainingMinutes = Math.ceil((cooldownMs - (now - parseInt(lastClear))) / 60000);
        showToast(currentLanguage === 'ar' ? `يرجى الانتظار ${remainingMinutes} دقائق...` : `Please wait ${remainingMinutes} minutes...`);
        return;
    }
    
    if (confirm(currentLanguage === 'ar' ? 'هل أنت متأكد من مسح جميع البيانات المخبأة؟' : 'Are you sure you want to clear all cached data?')) {
        // ✅ RATE-LIMIT: Set timestamp
        localStorage.setItem('matchlogic_last_cache_clear', now.toString());
        
        // Preserve important settings
        const language = localStorage.getItem('lang');
        const favorites = localStorage.getItem('matchlogic_favorites');
        const filter = localStorage.getItem('matchlogic_filter');
        
        // Clear all localStorage except important keys
        Object.keys(localStorage).forEach(key => {
            if (key !== 'lang' && key !== 'matchlogic_favorites' && key !== 'matchlogic_filter' && key !== 'matchlogic_last_cache_clear') {
                localStorage.removeItem(key);
            }
        });
        
        // Restore important settings
        if (language) localStorage.setItem('lang', language);
        if (favorites) localStorage.setItem('matchlogic_favorites', favorites);
        if (filter) localStorage.setItem('matchlogic_filter', filter);
        
        // Clear cache if available
        if ('caches' in window) {
            caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
        }
        
        // ✅ COMPLETE RESET: Ensure true fresh start
        dataCache = {};
        aiRendered = false;
        
        showToast(currentLanguage === 'ar' ? 'تم مسح جميع البيانات المخبأة' : 'All cached data cleared');
        
        // ✅ REFRESH: Reload current page to show fresh data
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    }
}

// ✅ LOCAL TIMEZONE FIX: Use user's local timezone instead of UTC
function getLocalDate(offsetDays = 0) {
    const now = new Date();
    now.setDate(now.getDate() + offsetDays);
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().split('T')[0];
}

// ✅ PAGE LOADERS: Load data for each page
async function loadTodayMatches() {
    const today = getLocalDate(0);
    await loadMatches(today, 'today');
}

async function loadYesterdayMatches() {
    const yesterday = getLocalDate(-1);
    await loadMatches(yesterday, 'yesterday');
}

async function loadTomorrowMatches() {
    const tomorrow = getLocalDate(1);
    await loadMatches(tomorrow, 'tomorrow');
}

// ✅ OVERHAULED FAVORITES PAGE
async function loadFavoritesPage() {
    const container = document.getElementById("matchesContainer");
    if (!container) return;
    
    // Render favorites header
    renderFavoritesHeader();
    
    // Display favorite matches
    await displayFavoritesMatches();
}

// ✅ RENDER FAVORITES HEADER WITH SEARCH AND CHIPS
function renderFavoritesHeader() {
    const container = document.getElementById("matchesContainer");
    if (!container) return;
    
    const favorites = getFavoriteTeams();
    
    const headerHTML = `
        <div class="favorites-header" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 20px; margin-bottom: 20px;">
            <h2 style="color: var(--text-main); margin-bottom: 15px;">${currentLanguage === 'ar' ? 'فرقك المفضلة' : 'Your Favorite Teams'}</h2>
            
            <div class="search-section" style="margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 10px;">
                <input type="text" id="favoritesSearchInput" placeholder="${currentLanguage === 'ar' ? 'ابحث عن فرق لإضافتها...' : 'Search teams to add...'}" 
                       style="flex: 1; min-width: 200px; padding: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; color: var(--text-main); font-size: 14px; box-sizing: border-box;">
                <button onclick="searchFavoriteTeams()" style="padding: 10px 20px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer; box-sizing: border-box;">
                    ${currentLanguage === 'ar' ? 'بحث عن فرق' : 'Search Teams'}
                </button>
            </div>
            
            <div class="favorite-chips" style="display: flex; flex-wrap: wrap; gap: 10px;">
                ${favorites.map(team => `
                    <div class="team-chip" style="display: flex; align-items: center; gap: 8px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 20px; padding: 8px 12px;">
                        <img src="${team.logo}" alt="${team.name}" style="width: 24px; height: 24px; object-fit: contain;" onerror="handleImageError(this)" />
                        <span style="color: var(--text-main); font-size: 14px;">${team.name}</span>
                        <button onclick="removeFavoriteTeam(${team.id})" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 0;">✕</button>
                    </div>
                `).join('')}
            </div>
        </div>
        <div id="teamSearchResultsContainer"></div>
    `;
    
    container.innerHTML = headerHTML;
    
    // ✅ ADD ENTER KEY LISTENER AFTER ELEMENT IS CREATED
    const favoritesSearchInput = document.getElementById('favoritesSearchInput');
    if (favoritesSearchInput) {
        favoritesSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchFavoriteTeams();
            }
        });
    }
}

// ✅ DISPLAY FAVORITES MATCHES
async function displayFavoritesMatches() {
    const container = document.getElementById("matchesContainer");
    if (!container) return;
    
    // Get today's matches and filter by favorites
    const today = getLocalDate(0);
    let cachedData = getCachedApiResponse(`matches-${today}`);
    let allMatches = cachedData?.response || [];
    
    // ✅ CACHE CHECK: If empty, fetch today's data first
    if (allMatches.length === 0) {
        try {
            const response = await fetch(`/api/matches?date=${today}`);
            const data = await response.json();
            allMatches = data?.response || [];
            
            // ✅ POPULATE CACHE: Store data without calling displayMatches
            setCachedApiResponse(`matches-${today}`, data, 'today');
            console.log('📊 Favorites: Fetched and cached today\'s matches');
        } catch (error) {
            console.error('❌ Error fetching matches for favorites:', error);
            // ✅ OFFLINE HANDLING: Check for network connectivity
            const container = document.getElementById("matchesContainer");
            if (container && (error instanceof TypeError || (error.name === 'TypeError' && error.message.includes('fetch')) || !navigator.onLine)) {
                container.innerHTML = `<div class="error-state">
                    <h3>عذراً، يبدو أنك غير متصل بالإنترنت</h3>
                    <p>يرجى التحقق من الشبكة وإعادة المحاولة</p>
                    <button id="retryBtn" style="margin-top: 10px; padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer;">إعادة المحاولة</button>
                </div>`;
                // ✅ CSP COMPLIANCE: Add event listener
                document.getElementById('retryBtn')?.addEventListener('click', () => location.reload());
            }
        }
    }
    
    const favorites = getFavoriteTeams();
    if (favorites.length === 0) {
        const searchResultsContainer = document.getElementById("teamSearchResultsContainer");
        if (searchResultsContainer) {
            searchResultsContainer.innerHTML = `<div class="empty-state" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 20px; margin-bottom: 20px;">
                <h3>${getTranslation('noFavoriteTeams')}</h3>
                <p>${getTranslation('addFavoriteTeams')}</p>
            </div>`;
        }
        return;
    }
    
    const favoriteIds = favorites.map(t => t.id);
    const favoriteMatches = allMatches.filter(m => {
        const homeId = m?.teams?.home?.id;
        const awayId = m?.teams?.away?.id;
        return favoriteIds.includes(homeId) || favoriteIds.includes(awayId);
    });
    
    if (favoriteMatches.length === 0) {
        const searchResultsContainer = document.getElementById("teamSearchResultsContainer");
        if (searchResultsContainer) {
            searchResultsContainer.innerHTML = `<div class="empty-state" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 20px; margin-bottom: 20px;">
                <h3>${currentLanguage === 'ar' ? 'لا توجد مباريات اليوم لفرقك المفضلة' : 'No matches today for your favorite teams'}</h3>
                <p>${currentLanguage === 'ar' ? 'تحقق لاحقاً' : 'Check back later'}</p>
            </div>`;
        }
        return;
    }
    
    // Create matches container and append to existing content
    const matchesContainer = document.createElement('div');
    matchesContainer.className = 'matches favorites-matches-wrap';
    matchesContainer.style.marginTop = '20px';
    renderMatchesLazy(favoriteMatches, matchesContainer);
    container.appendChild(matchesContainer);
}

// ✅ SEARCH FAVORITE TEAMS
async function searchFavoriteTeams() {
    const searchInput = document.getElementById('favoritesSearchInput');
    if (!searchInput) return;
    
    const query = searchInput.value.trim();
    if (!query) return;
    
    const teams = await searchTeamsForFavorites(query);
    renderTeamSearchResults(teams);
}

// ✅ REMOVE FAVORITE TEAM
function removeFavoriteTeam(teamId) {
    const favorites = getFavorites();
    const teamIndex = favorites.teams.findIndex(t => t.id === teamId);
    
    if (teamIndex > -1) {
        const teamName = favorites.teams[teamIndex].name;
        favorites.teams.splice(teamIndex, 1);
        saveFavorites(favorites);
        
        showToast(currentLanguage === 'ar' ? `تمت إزالة ${teamName} من المفضلة` : `${teamName} removed from favorites`);
        
        // Refresh favorites page
        loadFavoritesPage();
    }
}

async function loadMatches(date, pageType) {
    isLoading = true;
    showLoadingOverlay();
    
    try {
        const cacheKey = `matches-${date}`;
        const cachedData = getCachedApiResponse(cacheKey);
        
        if (cachedData) {
            currentPageData = cachedData?.response || cachedData?.data?.response || [];
            console.log('📊 Cache loaded:', currentPageData.length, 'matches');
            displayMatches(currentPageData, pageType); // ✅ FORCE RENDERING
            hideLoadingOverlay();
            return;
        }
        
        const res = await fetchWithErrorDeduplication(`/api/matches?date=${date}`);
        // ✅ SAFETY GUARD: Prevent crash if response is null/undefined
        if (!res) { hideLoadingOverlay(); return; }
        
        const data = await res.json();
        
        // ✅ API RESPONSE VALIDATION
        if (!data || (!data.response && !data.data)) {
            console.error("Invalid API response", data);
            hideLoadingOverlay();
            const container = document.getElementById("matchesContainer");
            if (container) {
                container.innerHTML = `<div class="error-state">
                    <h3>${currentLanguage === 'ar' ? 'تعذر تحميل المباريات' : 'Could not load matches'}</h3>
                    <p>${currentLanguage === 'ar' ? 'حدثت مشكلة في الاتصال بمصدر البيانات، حاول مرة أخرى بعد قليل' : 'There was a problem reaching the data source, please try again shortly'}</p>
                </div>`;
            }
            return;
        }
        
        currentPageData = data?.response || data?.data?.response || [];
        console.log('📊 Data loaded:', currentPageData.length, 'matches');
        
        // ✅ SMART CLIENT-SIDE CACHING: Set cache type based on page type and match status
        let cacheType = 'default';
        const NON_LIVE = ['NS', 'FT', 'AET', 'PEN', 'PST', 'CANC', 'SUSP', 'ABD', 'AWD', 'WO'];
        
        if (pageType === 'yesterday') {
            cacheType = 'finished'; // 10 mins for finished matches
        } else if (pageType === 'tomorrow') {
            cacheType = 'default'; // 5 mins for upcoming matches
        } else if (pageType === 'today') {
            // Check if any live matches exist
            if (currentPageData.some(m => !NON_LIVE.includes(m.fixture.status.short))) {
                cacheType = 'live'; // 30s for live matches
            } else {
                cacheType = 'today'; // 2 mins for today matches
            }
        }
        
        setCachedApiResponse(cacheKey, data, cacheType);
        
        displayMatches(currentPageData, pageType); // ✅ FORCE RENDERING
        
    } catch (error) {
        console.error('❌ Error loading matches:', error);
        const container = document.getElementById("matchesContainer");
        if (container) {
            // ✅ OFFLINE HANDLING: Check for network connectivity
            if (error instanceof TypeError || (error.name === 'TypeError' && error.message.includes('fetch')) || !navigator.onLine) {
                container.innerHTML = `<div class="error-state">
                    <h3>عذراً، يبدو أنك غير متصل بالإنترنت</h3>
                    <p>يرجى التحقق من الشبكة وإعادة المحاولة</p>
                    <button id="retryBtn" style="margin-top: 10px; padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer;">إعادة المحاولة</button>
                </div>`;
                // ✅ CSP COMPLIANCE: Add event listener
                document.getElementById('retryBtn')?.addEventListener('click', () => location.reload());
            } else {
                container.innerHTML = `<div class="error-state">
                    <h3>${getTranslation('errorLoadingData')}</h3>
                </div>`;
            }
        }
    } finally {
        isLoading = false;
        hideLoadingOverlay();
    }
}

// ✅ UTILITY FUNCTIONS: Show/hide loading and error states
function showLoadingOverlay() {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLoadingOverlay() {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

function getMatchStatus(match, pageType) {
    const statusShort = match.fixture?.status?.short;
    
    // ✅ FIX SCORE HTML: Show Time/VS for NS matches
    let scoreHtml;
    if (statusShort === "NS") {
        scoreHtml = formatMatchTime(match.fixture?.date) || "VS";
    } else {
        scoreHtml = `${match.goals?.home ?? 0} - ${match.goals?.away ?? 0}`;
    }
    
    let statusText, statusClass, isValid = true;
    
    if (statusShort === "FT" || statusShort === "AET" || statusShort === "PEN") {
        statusText = currentLanguage === 'ar' ? 'انتهت' : 'Finished';
        statusClass = "status-finished"; // ✅ SEPARATE: No pulsing for finished
    } else if (statusShort === "PST") {
        statusText = currentLanguage === 'ar' ? 'تأجلت' : 'Postponed';
        statusClass = "status-finished"; // ✅ SEPARATE: No pulsing for postponed
    } else if (statusShort === "NS") {
        statusText = formatMatchTime(match.fixture?.date) || (currentLanguage === 'ar' ? 'لم تبدأ' : 'Not Started');
        statusClass = "status-finished"; // ✅ SEPARATE: No pulsing for not started
    } else if (statusShort === "HT") {
        statusText = currentLanguage === 'ar' ? 'استراحة' : 'Half Time';
        statusClass = "status"; // ✅ LIVE: Pulsing for live
    } else if (statusShort && statusShort !== "NS" && statusShort !== "PST") {
        const minute = match.fixture?.status?.elapsed;
        statusText = minute ? `${currentLanguage === 'ar' ? 'مباشر' : 'Live'} ${minute}'` : (currentLanguage === 'ar' ? 'مباشر' : 'Live');
        statusClass = "status"; // ✅ LIVE: Pulsing for live
    } else {
        statusText = formatMatchTime(match.fixture?.date) || (currentLanguage === 'ar' ? 'لم تبدأ' : 'Not Started');
        statusClass = "status-finished"; // ✅ SEPARATE: No pulsing for other
    }
    
    return { scoreHtml, statusText, statusClass, isValid };
}

function formatMatchTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    
    // ✅ RETURN LOCAL ACTUAL TIME - no countdown
    return date.toLocaleTimeString(currentLanguage === 'ar' ? 'ar-SA' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}


function showSmartError(type) {
    const messages = {
        rate_limit: currentLanguage === 'ar' ? 'تم تجاوز الحد المسموح. يرجى المحاولة لاحقاً.' : 'Rate limit exceeded. Please try again later.',
        server_error: currentLanguage === 'ar' ? 'خطأ في الخادم. يرجى المحاولة لاحقاً.' : 'Server error. Please try again later.',
        network_error: currentLanguage === 'ar' ? 'خطأ في الاتصال. يرجى التحقق من اتصالك.' : 'Network error. Please check your connection.'
    };
    
    const container = document.getElementById("matchesContainer");
    if (container) {
        container.innerHTML = `<div class="error-state">
            <h3>❌ ${messages[type] || 'Unknown error'}</h3>
        </div>`;
    }
}

// ✅ ELITE LEAGUES: Professional leagues filter
const ELITE_LEAGUES = {
    39: 'Premier League',
    140: 'La Liga',
    135: 'Serie A',
    78: 'Bundesliga',
    61: 'Ligue 1'
};

function isLiveMatch(match) {
    const status = match.fixture?.status?.short;
    return status && status !== 'NS' && status !== 'FT' && status !== 'PST' && status !== 'AET' && status !== 'PEN';
}

// ✅ LEGACY FAVORITES FUNCTIONS (for compatibility)
function addFavorite(team) {
    toggleFavoriteTeam(team.id, team.name, team.logo);
}

function removeFavorite(teamId) {
    const favorites = getFavorites();
    favorites.teams = favorites.teams.filter(t => t.id !== teamId);
    saveFavorites(favorites);
    
    // Refresh display if on favorites page
    if (currentPage === "favorites") {
        displayMatches(currentPageData);
    }
}

// ✅ EXPORT ALL FUNCTIONS TO GLOBAL SCOPE
window.handleSearch = debouncedSearch;
window.handleSearchInput = query => debouncedSearch(query);
window.clearSearch = () => { document.getElementById('searchInput').value=''; searchQuery=''; debouncedSearch(''); };
window.toggleLiveFilter = () => {
    showLiveOnly = !showLiveOnly;
    
    // ✅ UPDATE BUTTON STYLES
    const liveFilterBtn = document.getElementById('liveFilterBtn');
    if (liveFilterBtn) {
        if (showLiveOnly) {
            liveFilterBtn.style.background = 'var(--live)';
            liveFilterBtn.style.color = 'white';
        } else {
            liveFilterBtn.style.background = 'var(--bg-elevated)';
            liveFilterBtn.style.color = 'var(--text-main)';
        }
    }
    
    // ✅ FILTER LOGIC: Apply live filter if active
    if (showLiveOnly) {
        const liveMatches = currentPageData.filter(match => {
            const statusShort = match.fixture?.status?.short;
            return LIVE_STATUSES.includes(statusShort);
        });
        displayMatches(liveMatches);
    } else {
        displayMatches(currentPageData);
    }
};
window.displayMatches = displayMatches;
window.changePage = changePage;
window.addFavorite = addFavorite;
window.removeFavorite = removeFavorite;
window.togglePageMode = togglePageMode;
window.toggleFavoriteTeam = toggleFavoriteTeam;
window.toggleFavoriteLeague = toggleFavoriteLeague;
window.setLanguage = setLanguage;
window.searchGlobalTeams = searchGlobalTeams;
window.searchFavoriteTeams = searchFavoriteTeams;
window.removeFavoriteTeam = removeFavoriteTeam;
window.clearAllCache = clearAllCache;
window.clearTeamSearch = clearTeamSearch;

// ✅ APP INITIALIZATION: Language-first approach
function initializeApp() {
    console.log('🚀 MatchLogic Application Initialized');
    
    // ✅ CSP COMPLIANCE: Setup event listeners
    setupEventListeners();
    
    // ✅ TRANSLATE NAV TABS: Apply language to navigation
    const tabTranslations = {
        todayTab: currentLanguage === 'ar' ? 'اليوم' : 'Today',
        yesterdayTab: currentLanguage === 'ar' ? 'الأمس' : 'Yesterday',
        tomorrowTab: currentLanguage === 'ar' ? 'الغد' : 'Tomorrow',
        favoritesTab: currentLanguage === 'ar' ? '⭐ المفضلة' : '⭐ Favorites',
        settingsTab: currentLanguage === 'ar' ? '⚙ الإعدادات' : '⚙ Settings'
    };
    Object.entries(tabTranslations).forEach(([id, text]) => {
        const tab = document.getElementById(id);
        if (tab) tab.textContent = text;
    });
    
    clearExpiredCache();
    const initialPage = window.location.hash.substring(1) || 'today';
    console.log('📄 Loading initial page:', initialPage);
    changePage(initialPage);
    window.addEventListener('hashchange', () => changePage(window.location.hash.substring(1) || 'today'));
    
    console.log('📊 Search filtering working');
    console.log('🤖 AI button redirect active');

    // ✅ SEO: Inject homepage Schema.org structured data for Google Rich Snippets
    injectStructuredData();
}


// ✅ CSP COMPLIANCE: Add event listeners programmatically
function setupEventListeners() {
    // Header logo error handling
    const headerLogo = document.getElementById('headerLogo');
    if (headerLogo) {
        headerLogo.addEventListener('error', () => {
            headerLogo.onerror = null;
            headerLogo.src = '/icons/fallback-logo.png';
        });
    }
    
    // Navigation tabs
    document.getElementById('todayTab')?.addEventListener('click', () => changePage('today'));
    document.getElementById('yesterdayTab')?.addEventListener('click', () => changePage('yesterday'));
    document.getElementById('tomorrowTab')?.addEventListener('click', () => changePage('tomorrow'));
    document.getElementById('favoritesTab')?.addEventListener('click', () => changePage('favorites'));
    document.getElementById('settingsTab')?.addEventListener('click', () => changePage('settings'));
    
    // Search and filter controls
    document.getElementById('clearSearch')?.addEventListener('click', clearSearch);
    document.getElementById('liveFilterBtn')?.addEventListener('click', toggleLiveFilter);
    document.getElementById('toggleFilterBtn')?.addEventListener('click', toggleFilter);
    
    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearchInput(document.getElementById('searchInput').value);
            }
        });
    }
}

// ✅ GLOBAL IMAGE ERROR HANDLER — neutral placeholder, never the site logo
window.handleImageError = function(img) {
    img.onerror = null;
    img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+PGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjIiIGZpbGw9IiMxNjIzMzgiIHN0cm9rZT0iIzI1MzY1MSIgc3Ryb2tlLXdpZHRoPSIyIi8+PHBhdGggZD0iTTI0IDEyYTEyIDEyIDAgMSAwIDAgMjQgMTIgMTIgMCAwIDAgMC0yNHptMCAyMS41YTkuNSA5LjUgMCAxIDEgMC0xOSA5LjUgOS41IDAgMCAxIDAgMTl6IiBmaWxsPSIjNWU3Mzk0Ii8+PC9zdmc+';
    img.style.opacity = '0.5';
}

// ✅ DOM READY INIT
document.addEventListener('DOMContentLoaded', () => {
    // ✅ PERFORMANCE: Cache static DOM refs once — avoids repeated getElementById
    // calls inside hot rendering/filtering/search functions.
    domMatchesContainer = document.getElementById('matchesContainer');
    domTeamSearchResultsContainer = document.getElementById('teamSearchResultsContainer');

    // ✅ INFINITE SCROLL: Create the single persistent sentinel + observer.
    // Must run after DOM is ready so the element can be appended to containers.
    initScrollSentinel();

    // ✅ LANGUAGE-FIRST: Check language before initializing app
    if (initializeLanguage()) {
        // Language already set, initialize app
        initializeApp();
    }
    // If language not set, modal will show and initializeApp() will be called after selection
});

// ✅ SEO: Fetch Schema.org structured data from server and inject into <head>
// so Googlebot reads SportsEvent markup even on first crawl before JS executes.
// Called once per page load from initializeApp().
async function injectStructuredData() {
    try {
        const response = await fetch('/api/structured-data');
        if (response.ok) {
            const schemaData = await response.json();
            const script = document.createElement('script');
            script.type = 'application/ld+json';
            script.text = JSON.stringify(schemaData);
            document.head.appendChild(script);
            console.log('✅ Google SEO Schema Injected');
        }
    } catch (e) {
        console.log('⚠️ Schema injection skipped');
    }
}
