// ✅ GLOBAL NAVIGATION FUNCTION
window.goBack = () => {
    window.history.back();
};

// ✅ XSS PROTECTION: Sanitize API strings before innerHTML injection.
// Player names, team names, and event details from api-sports must pass through
// this before being inserted into the DOM.
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ✅ AI RENDER FLAG TO PREVENT DOUBLE CALLS
let aiRendered = false;

// ✅ MATCH PAGE TRANSLATIONS
const matchPageTranslations = {
    ar: {
        events: 'الأحداث',
        lineups: 'التشكيلة', 
        statistics: 'الإحصائيات',
        ai: 'تحليل الذكاء الاصطناعي',
        standings: 'الترتيب',
        back: 'العودة',
        loading: 'جاري التحميل...',
        loadingAI: 'جاري تحليل الذكاء الاصطناعي...',
        noEvents: 'لا توجد أحداث',
        noLineups: 'لا توجد تشكيلة',
        noStatistics: 'لا توجد إحصائيات',
        noStandings: 'لا توجد ترتيب',
        errorLoading: 'خطأ في التحميل'
    },
    en: {
        events: 'Events',
        lineups: 'Lineups',
        statistics: 'Statistics', 
        ai: 'AI Analysis',
        standings: 'Standings',
        back: 'Back',
        loading: 'Loading...',
        loadingAI: 'Analyzing with AI...',
        noEvents: 'No events',
        noLineups: 'No lineups',
        noStatistics: 'No statistics',
        noStandings: 'No standings',
        errorLoading: 'Error loading'
    }
};

// ✅ APPLY MATCH PAGE LANGUAGE
function applyMatchPageLanguage() {
    const translations = matchPageTranslations[getLang()];
    
    // Update page direction
    document.documentElement.dir = getLang() === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = getLang();
    
    // Update tab labels
    const tabEvents = document.getElementById('tabEvents');
    const tabLineups = document.getElementById('tabLineups');
    const tabStatistics = document.getElementById('tabStatistics');
    const tabAi = document.getElementById('tabAi');
    const tabMatches = document.getElementById('tabMatches');
    
    if (tabEvents) tabEvents.textContent = translations.events;
    if (tabLineups) tabLineups.textContent = translations.lineups;
    if (tabStatistics) tabStatistics.textContent = translations.statistics;
    if (tabAi) tabAi.textContent = translations.ai;
    if (tabMatches) tabMatches.textContent = translations.standings;
    
    // Update loading messages
    const loadingElements = document.querySelectorAll('.loading');
    loadingElements.forEach(el => {
        if (el.closest('#panelAi')) {
            el.textContent = translations.loadingAI;
        } else {
            el.textContent = translations.loading;
        }
    });
    
    // Update back button
    const backButton = document.querySelector('[onclick*="goBack"], button[onclick*="history.back"]');
    if (backButton) {
        backButton.textContent = translations.back;
    }
}

// ✅ HIDE LOADING HELPER
function hideLoading() {
    const loadingElements = document.querySelectorAll('.loading');
    loadingElements.forEach(el => {
        if (el.textContent.includes('Loading') || el.textContent.includes('جاري')) {
            el.style.display = 'none';
            el.textContent = '';
        }
    });
}

const params = new URLSearchParams(window.location.search);
const matchId = params.get("id");

// ✅ LIVE LANGUAGE READ (bug fix): previously this was `const getLang() =
// localStorage.getItem("lang")`, captured ONCE when match.js first loaded. If the
// user changed language on index.html and came back to an already-open match page
// (e.g. via browser back/forward, which can restore the page from bfcache without
// re-running this script), the old `getLang()` constant stayed frozen at the
// stale value — so the AI analysis request kept sending the old lang= and showing
// old text. getLang() always reads localStorage fresh, so it can never go stale.
function getLang() { return localStorage.getItem("lang") || "ar"; }

// ✅ PAGE VISIBILITY: Re-apply language/direction and refresh AI text if the user
// returns to this tab/page after switching language elsewhere (covers bfcache restores).
let _lastSeenLanguage = getLang();
function _handlePossibleLanguageChange() {
    if (getLang() !== _lastSeenLanguage) {
        _lastSeenLanguage = getLang();
        applyMatchPageLanguage();
        if (window.currentMatch) {
            aiRendered = false;
            window._aiForceRefresh?.();
        }
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _handlePossibleLanguageChange();
});
window.addEventListener('pageshow', (event) => {
    if (event.persisted) _handlePossibleLanguageChange();
});

// ✅ TRANSLATIONS DICTIONARY
const labels = {
    ar: {
        loading: "جاري جلب تفاصيل المباراة...",
        error: "حدث خطأ أثناء جلب البيانات",
        notFound: "لم يتم العثور على تفاصيل المباراة",
        finished: "انتهت",
        live: "مباشر",
        notStarted: "لم تبدأ",
        postponed: "تأجلت",
        matchDetails: "تفاصيل المباراة",
        aiPrediction: "توقعات الذكاء الاصطناعي 🤖",
        homeWin: "فوز المضيف",
        draw: "تعادل",
        awayWin: "فوز الضيف",
        formInsights: "رؤى الأداء",
        rateLimit: "تم تجاوز الحد المسموح للطلبات، يرجى المحاولة لاحقاً."
    },
    en: {
        loading: "Loading match details...",
        error: "Error fetching data",
        notFound: "Match details not found",
        finished: "Finished",
        live: "Live",
        notStarted: "Not Started",
        postponed: "Postponed",
        matchDetails: "Match Details",
        aiPrediction: "AI Prediction 🤖",
        homeWin: "Home Win",
        draw: "Draw",
        awayWin: "Away Win",
        formInsights: "Form Insights",
        rateLimit: "Rate limit exceeded, please try again later."
    }
};

// ✅ EVENT DETAIL TRANSLATIONS
const eventDetailTranslations = {
    ar: {
        'Normal Goal': 'هدف عادي',
        'Own Goal': 'هدف في مرماه',
        'Penalty': 'ركلة جزاء',
        'Missed Penalty': 'ركلة جزاء فائتة',
        'Yellow Card': 'بطاقة صفراء',
        'Red Card': 'بطاقة حمراء',
        'Second Yellow card': 'بطاقة صفراء ثانية',
        'Substitution 1': 'تبديل',
        'Substitution 2': 'تبديل',
        'Substitution 3': 'تبديل',
        'Substitution 4': 'تبديل',
        'Substitution 5': 'تبديل',
        'VAR - Goal cancelled': 'VAR - هدف ملغي',
        'VAR - Penalty confirmed': 'VAR - ركلة جزاء مؤكدة',
        'VAR - Penalty cancelled': 'VAR - ركلة جزاء ملغاة',
        'VAR - Red Card': 'VAR - بطاقة حمراء',
        'minute': 'دقيقة'
    },
    en: {
        'Normal Goal': 'Normal Goal',
        'Own Goal': 'Own Goal',
        'Penalty': 'Penalty',
        'Missed Penalty': 'Missed Penalty',
        'Yellow Card': 'Yellow Card',
        'Red Card': 'Red Card',
        'Second Yellow card': 'Second Yellow Card',
        'Substitution 1': 'Substitution',
        'Substitution 2': 'Substitution',
        'Substitution 3': 'Substitution',
        'Substitution 4': 'Substitution',
        'Substitution 5': 'Substitution',
        'VAR - Goal cancelled': 'VAR - Goal Cancelled',
        'VAR - Penalty confirmed': 'VAR - Penalty Confirmed',
        'VAR - Penalty cancelled': 'VAR - Penalty Cancelled',
        'VAR - Red Card': 'VAR - Red Card',
        'minute': 'min'
    }
};

function getTranslation(key) {
    return labels[getLang()]?.[key] || key;
}

function getEventDetailTranslation(detail) {
    return eventDetailTranslations[getLang()]?.[detail] || detail;
}

// ✅ LOCAL TIMEZONE FIX: Use user's local timezone instead of UTC
function getDate(type) {
    const now = new Date();
    if (type === "yesterday") now.setDate(now.getDate() - 1);
    else if (type === "tomorrow") now.setDate(now.getDate() + 1);
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().split('T')[0];
}

// ✅ MAIN LOADER (DIRECT FETCH)
// ✅ SEO: Update page title and meta tags with actual team names/score once known.
// Without this, every match page shows the same generic "تفاصيل المباراة" title,
// which prevents Google from surfacing a *specific* match in search results when
// someone searches for e.g. "نتيجة مباراة الأهلي والزمالك اليوم".
function updatePageMetaForMatch(match) {
    try {
        const homeName = match?.teams?.home?.name || '';
        const awayName = match?.teams?.away?.name || '';
        if (!homeName || !awayName) return;

        const homeGoals = match?.goals?.home;
        const awayGoals = match?.goals?.away;
        const hasScore = homeGoals !== null && homeGoals !== undefined && awayGoals !== null && awayGoals !== undefined;
        const scorePart = hasScore ? `${homeGoals}-${awayGoals}` : '';
        const leagueName = match?.league?.name || '';

        const isAr = getLang() === 'ar';
        const titleText = isAr
            ? `${homeName} ${scorePart} ${awayName} | ماتش لوجيك`.replace(/\s+/g, ' ').trim()
            : `${homeName} ${scorePart} ${awayName} | MatchLogic`.replace(/\s+/g, ' ').trim();

        const descText = isAr
            ? `تابع مباراة ${homeName} ضد ${awayName}${leagueName ? ' في ' + leagueName : ''} لحظة بلحظة: النتيجة، الأهداف، التشكيلة، الإحصائيات، وتحليل ذكي للمباراة.`
            : `Follow ${homeName} vs ${awayName}${leagueName ? ' in ' + leagueName : ''} live: score, goals, lineups, stats and AI match analysis.`;

        document.title = titleText;

        const metaDesc = document.getElementById('metaDesc');
        if (metaDesc) metaDesc.setAttribute('content', descText);

        const ogTitle = document.getElementById('ogTitle');
        if (ogTitle) ogTitle.setAttribute('content', titleText);

        const ogDesc = document.getElementById('ogDesc');
        if (ogDesc) ogDesc.setAttribute('content', descText);

        const canonicalUrl = `https://matchlogic-server.vercel.app/match.html?id=${matchId}`;
        const ogUrl = document.getElementById('ogUrl');
        if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);

        const canonicalTag = document.getElementById('canonicalTag');
        if (canonicalTag) canonicalTag.setAttribute('href', canonicalUrl);

        // ✅ SEO: Dynamic SportsEvent Schema for Google Rich Snippets.
        // Injected per-match so Googlebot gets accurate structured data for
        // each individual match page. Old script removed first to prevent
        // duplicate schemas when navigating between matches in the same session.
        const matchSchema = {
            "@context": "https://schema.org",
            "@type": "SportsEvent",
            "name": `${homeName} vs ${awayName}`,
            "description": descText,
            "startDate": match.fixture?.date,
            "eventStatus": match.fixture?.status?.short === 'FT'
                ? "https://schema.org/EventScheduled"
                : "https://schema.org/EventScheduled",
            "homeTeam": {
                "@type": "SportsTeam",
                "name": homeName
            },
            "awayTeam": {
                "@type": "SportsTeam",
                "name": awayName
            }
        };
        const oldSchema = document.getElementById('dynamic-match-schema');
        if (oldSchema) oldSchema.remove();
        const schemaScript = document.createElement('script');
        schemaScript.id = 'dynamic-match-schema';
        schemaScript.type = 'application/ld+json';
        schemaScript.text = JSON.stringify(matchSchema);
        document.head.appendChild(schemaScript);
    } catch (e) {
        console.error('⚠️ updatePageMetaForMatch failed (non-critical):', e);
    }
}

async function loadMatchDetails() {
    const wrap = document.getElementById("matchHeaderInfo");
    if (!wrap) return;

    if (!matchId) {
        wrap.innerHTML = `<p class='error'>${getTranslation("notFound")}</p>`;
        hideLoading();
        return;
    }

    wrap.innerHTML = `<p class='loading'>${getTranslation("loading")}</p>`;

    try {
        // 🚀 DIRECT FETCH: Get specific match by ID
        const response = await fetch(`/api/matches?id=${matchId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // ✅ CORRECTLY PARSE: data.response[0]
        const currentMatch = data.response?.[0];
        
        if (currentMatch) {
            window.currentMatch = currentMatch;
            renderMatchDetails(currentMatch, wrap);
            updatePageMetaForMatch(currentMatch); // ✅ SEO: unique title/description per match
            aiRendered = false; // Reset AI render flag for new match
            
            // ✅ AUTO LOAD: Start loading events panel immediately
            setActiveTab('events');
            
            // ✅ AUTO SCROLL: Support direct navigation to AI section
            autoScrollToAI();
        } else {
            wrap.innerHTML = `<p class='error'>${getTranslation("notFound")}</p>`;
        }
        
        // ✅ REMOVED: Don't hide loading globally - let render functions handle their containers
        
    } catch (error) {
        console.error('❌ Error loading match details:', error);
        wrap.innerHTML = `<p class='error'>${getTranslation("error")}</p>`;
        
        // ✅ REMOVED: Don't hide loading globally - let render functions handle their containers
    }
}

// ✅ TAB MANAGEMENT: Handle tab switching
function setActiveTab(tabId) {
    // Hide all panels
    document.querySelectorAll('.match-detail-panel').forEach(panel => {
        panel.hidden = true;
        panel.classList.remove('active');
    });
    
    // Remove active class from all tabs
    document.querySelectorAll('.match-detail-tab').forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
    });
    
    // Show selected panel
    const targetPanel = document.getElementById(`panel${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
    if (targetPanel) {
        targetPanel.hidden = false;
        targetPanel.classList.add('active');
    }
    
    // Set active tab
    const activeTab = document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.setAttribute('aria-selected', 'true');
    }
    
    // Load content based on tab (only first time using dataset.loaded)
    if (tabId === 'ai' && window.currentMatch && !aiRendered) {
        renderAIPrediction(window.currentMatch);
        // ✅ AI RETRY LOGIC: Don't set aiRendered here - renderAIPrediction handles it
    } else if (tabId === 'events' && !activeTab?.dataset.loaded) {
        loadEvents(matchId);
        activeTab.dataset.loaded = 'true';
    } else if (tabId === 'lineups' && !activeTab?.dataset.loaded) {
        loadLineups(matchId);
        // ✅ REMOVED: Don't set loaded here - loadLineups handles it
    } else if (tabId === 'statistics' && !activeTab?.dataset.loaded) {
        loadStatistics(matchId);
    } else if (tabId === 'matches' && !activeTab?.dataset.loaded && window.currentMatch) {
        loadStandings(window.currentMatch);
        activeTab.dataset.loaded = 'true';
    }
}

// ✅ MATCH DATA LOADERS
async function loadEvents(id) {
    const container = document.getElementById('panelEvents');
    // Show skeleton while loading
    if (container) container.innerHTML = `
        <div class="skeleton-card"><div class="skeleton skeleton-text" style="width:40%"></div><div class="skeleton skeleton-text" style="width:70%"></div></div>
        <div class="skeleton-card"><div class="skeleton skeleton-text" style="width:30%"></div><div class="skeleton skeleton-text" style="width:60%"></div></div>
        <div class="skeleton-card"><div class="skeleton skeleton-text" style="width:50%"></div><div class="skeleton skeleton-text" style="width:80%"></div></div>`;
    try {
        const response = await fetch(`/api/match/events/${id}`);
        const data = await response.json();
        if (container && data?.response) {
            renderEvents(data.response);
        } else if (container) {
            container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
                <div style="font-size:24px;margin-bottom:10px">📋</div>
                <div style="font-size:14px;margin-bottom:16px">${getLang()==='ar'?'لا توجد أحداث بعد':'No events yet'}</div>
                <button onclick="window.loadEvents('${id}')" style="background:var(--primary);color:white;border:none;padding:8px 20px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">🔄 ${getLang()==='ar'?'إعادة المحاولة':'Retry'}</button>
            </div>`;
        }
    } catch (error) {
        console.error('❌ Error loading events:', error);
        if (container) container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
            <div style="font-size:24px;margin-bottom:10px">⚠️</div>
            <div style="font-size:14px;margin-bottom:16px">${getLang()==='ar'?'خطأ في تحميل الأحداث':'Error loading events'}</div>
            <button onclick="window.loadEvents('${id}')" style="background:var(--primary);color:white;border:none;padding:8px 20px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">🔄 ${getLang()==='ar'?'إعادة المحاولة':'Retry'}</button>
        </div>`;
    }
}

async function loadLineups(id) {
    const container = document.getElementById('panelLineups');
    if (container) container.innerHTML = `
        <div class="skeleton-card"><div class="skeleton skeleton-text" style="width:50%"></div><div class="skeleton skeleton-text" style="width:100%"></div><div class="skeleton skeleton-text" style="width:100%"></div><div class="skeleton skeleton-text" style="width:80%"></div></div>
        <div class="skeleton-card"><div class="skeleton skeleton-text" style="width:50%"></div><div class="skeleton skeleton-text" style="width:100%"></div><div class="skeleton skeleton-text" style="width:100%"></div><div class="skeleton skeleton-text" style="width:80%"></div></div>`;
    try {
        const response = await fetch(`/api/match/lineups/${id}`);
        const data = await response.json();
        const container = document.getElementById('panelLineups');
        
        if (container) {
            // ✅ SMART LINEUP LOGIC: Check if data exists and has content
            if (data?.response && data.response.length > 0) {
                renderLineups(data.response);
                // ✅ ONLY SET LOADED IF ACTUAL LINEUPS EXIST
                const activeTab = document.getElementById('tabLineups');
                if (activeTab) {
                    activeTab.dataset.loaded = 'true';
                }
            } else {
                // ✅ FRIENDLY MESSAGE: Lineups not available yet
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                        <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
                        <div style="font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
                            ${getLang() === 'ar' ? 'التشكيلة غير متوفرة حالياً' : 'Lineups not available yet'}
                        </div>
                        <button onclick="window.loadLineups('${id}')" style="background: var(--primary); color: white; border: none; padding: 8px 20px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit;">
                            🔄 ${getLang() === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                        </button>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('❌ Error loading lineups:', error);
        const container = document.getElementById('panelLineups');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                    <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
                    <div style="font-size: 14px; line-height: 1.5;">
                        ${getLang() === 'ar' ? 
                            'خطأ في تحميل التشكيلة' : 
                            'Error loading lineups'
                        }
                    </div>
                </div>
            `;
        }
    }
}

async function loadStatistics(id) {
    const container = document.getElementById('panelStatistics');
    if (container) container.innerHTML = `
        <div class="skeleton-card"><div class="skeleton skeleton-text" style="width:60%"></div><div class="skeleton" style="height:10px;border-radius:5px;margin-bottom:8px"></div></div>
        <div class="skeleton-card"><div class="skeleton skeleton-text" style="width:40%"></div><div class="skeleton" style="height:10px;border-radius:5px;margin-bottom:8px"></div></div>
        <div class="skeleton-card"><div class="skeleton skeleton-text" style="width:70%"></div><div class="skeleton" style="height:10px;border-radius:5px;margin-bottom:8px"></div></div>`;
    try {
        const response = await fetch(`/api/match/statistics/${id}`);
        const data = await response.json();
        if (container && data?.response && data.response.length > 0) {
            renderStatistics(data.response);
            document.getElementById('tabStatistics').dataset.loaded = 'true';
        } else if (container) {
            container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
                <div style="font-size:24px;margin-bottom:10px">📊</div>
                <div style="font-size:14px;margin-bottom:16px">${getLang()==='ar'?'الإحصائيات غير متاحة — تظهر بعد بداية المباراة':'Statistics unavailable — shown after match starts'}</div>
                <button onclick="window.loadStatistics('${id}')" style="background:var(--primary);color:white;border:none;padding:8px 20px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">🔄 ${getLang()==='ar'?'إعادة المحاولة':'Retry'}</button>
            </div>`;
        }
    } catch (error) {
        console.error('❌ Error loading statistics:', error);
        if (container) container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
            <div style="font-size:24px;margin-bottom:10px">⚠️</div>
            <div style="font-size:14px;margin-bottom:16px">${getLang()==='ar'?'خطأ في تحميل الإحصائيات':'Error loading statistics'}</div>
            <button onclick="window.loadStatistics('${id}')" style="background:var(--primary);color:white;border:none;padding:8px 20px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">🔄 ${getLang()==='ar'?'إعادة المحاولة':'Retry'}</button>
        </div>`;
    }
}

// ✅ RENDER FUNCTIONS FOR MATCH DATA
// ✅ Event type from the API comes as a short code (e.g. "subst", "Goal", "Card"),
// while getEventIcon() was written for the long "Substitution" form — they never
// matched, so substitution rows always fell back to the generic 📋 icon.
function normalizeEventType(type) {
    const map = { 'subst': 'Substitution', 'Card': 'Card' };
    return map[type] || type;
}

function renderEvents(events) {
    const container = document.getElementById('panelEvents');
    if (!container) return;
    const isAr = getLang() === 'ar';

    const eventsHTML = events.map(event => {
        const normalizedType = normalizeEventType(event.type);
        const translatedDetail = event.detail ? getEventDetailTranslation(event.detail) : '';

        // ✅ SUBSTITUTION: api-football's field naming is counter-intuitive —
        // confirmed directly from their own docs/support examples:
        //   event.player  = the player going OUT
        //   event.assist  = the player coming IN
        // Show both clearly: green "IN" badge for the player entering,
        // red "OUT" badge for the player leaving.
        if (normalizedType === 'Substitution') {
            const playerOut = escapeHTML(event.player?.name || '');
            const playerIn = escapeHTML(event.assist?.name || '');
            return `
            <div class="event-item event-item-subst">
                <span class="event-time">${event.time.elapsed}'</span>
                <span class="event-type">🔄</span>
                <div class="event-subst-players">
                    ${playerIn ? `<div class="subst-row subst-in">
                        <span class="subst-badge subst-badge-in">${isAr ? 'دخول' : 'IN'}</span>
                        <span class="subst-player-name">${playerIn}</span>
                    </div>` : ''}
                    ${playerOut ? `<div class="subst-row subst-out">
                        <span class="subst-badge subst-badge-out">${isAr ? 'خروج' : 'OUT'}</span>
                        <span class="subst-player-name">${playerOut}</span>
                    </div>` : ''}
                </div>
            </div>`;
        }

        return `
        <div class="event-item">
            <span class="event-time">${event.time.elapsed}'</span>
            <span class="event-type">${getEventIcon(normalizedType)}</span>
            <span class="event-player">${escapeHTML(event.player?.name || '')}</span>
            <span class="event-detail">${escapeHTML(translatedDetail)}</span>
        </div>
    `;
    }).join('');

    container.innerHTML = eventsHTML || `<p style="color: var(--text-muted);">${isAr ? 'لا توجد أحداث' : 'No events'}</p>`;
}

function renderLineups(lineups) {
    const container = document.getElementById('panelLineups');
    if (!container) return;
    
    let lineupsHTML = '';
    lineups.forEach((lineup, index) => {
        const teamColor = index === 0 ? 'var(--primary)' : '#ef4444';
        
        // ✅ CORRECT FORMATION PARSING: Parse formation string and show goalkeeper separately
        const formation = lineup.formation || '4-4-2';
        const players = lineup.startXI || [];
        const goalkeeper = players.slice(0, 1);
        const outfield = players.slice(1);
        const lines = formation.split('-').map(Number);
        let playerIndex = 0;
        const rows = lines.map(count => {
            const row = outfield.slice(playerIndex, playerIndex + count);
            playerIndex += count;
            return row;
        });
        rows.unshift(goalkeeper);
        
        lineupsHTML += `
            <div class="lineup-section" style="margin-bottom: 20px; padding: 20px; background: var(--bg-elevated); border-radius: 8px; border-inline-start: 4px solid ${teamColor};">
                <h4 style="color: var(--text-main); margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
                    <img src="${escapeHTML(lineup.team?.logo || '')}" alt="${escapeHTML(lineup.team?.name || '')}" style="width: 32px; height: 32px; object-fit: contain;" onerror="handleImageError(this)" />
                    ${escapeHTML(lineup.team?.name || '')}
                </h4>
                <div class="formation" style="color: var(--text-muted); margin-bottom: 15px; font-weight: 500;">${escapeHTML(formation)}</div>
                
                <!-- ✅ VISUAL FOOTBALL PITCH WITH CORRECT FORMATION -->
                <div class="football-pitch">
                    ${rows.map(row => `
                        <div class="pitch-row">
                            ${row.map(player => `
                                <div class="pitch-player">
                                    <div class="player-circle" style="background: linear-gradient(135deg, ${teamColor} 0%, rgba(0,0,0,0.3) 100%);">
                                        ${escapeHTML(String(player.player?.number || ''))}
                                    </div>
                                    <div class="player-name">${escapeHTML(player.player?.name || '')}</div>
                                </div>
                            `).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = lineupsHTML || `<p style="color: var(--text-muted);">${getLang() === 'ar' ? 'لا توجد تشكيلات' : 'No lineups'}</p>`;
}

// ✅ STANDINGS LOADER: Load league standings
async function loadStandings(match) {
    try {
        const leagueId = match.league?.id;
        const season = match.league?.season || new Date().getFullYear();
        
        if (!leagueId) {
            throw new Error('League ID not available');
        }
        
        const response = await fetch(`/api/standings/${leagueId}/${season}`);
        const data = await response.json();
        const container = document.getElementById('panelMatches');
        
        if (container && data?.response?.[0]?.league?.standings) {
            const flatStandings = data.response[0].league.standings.flat();
            renderStandings(flatStandings, match);
        } else if (container) {
            // ✅ STANDINGS EMPTY STATE: League not available
            container.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">${getLang() === 'ar' ? 'الترتيب غير متاح لهذا الدوري' : 'Standings not available for this league'}</p>`;
        }
    } catch (error) {
        console.error('❌ Error loading standings:', error);
        const container = document.getElementById('panelMatches');
        if (container) {
            container.innerHTML = `<p style="color: var(--text-muted);">${getLang() === 'ar' ? 'خطأ في تحميل الترتيب' : 'Error loading standings'}</p>`;
        }
    }
}

// ✅ STANDINGS RENDERER: Display league table with team highlighting
function renderStandings(standings, match) {
    const container = document.getElementById('panelMatches');
    if (!container) return;
    
    if (!standings || standings.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted);">${getLang() === 'ar' ? 'لا توجد بيانات ترتيب' : 'No standings data available'}</p>`;
        return;
    }
    
    const homeTeamId = match.teams?.home?.id;
    const awayTeamId = match.teams?.away?.id;
    
    let standingsHTML = `
        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
            <table style="width: 100%; border-collapse: collapse; background: var(--bg-elevated); border-radius: 8px; overflow: hidden;">
                <thead>
                    <tr style="background: var(--primary); color: white;">
                        <th style="padding: 12px; text-align: center;">${getLang() === 'ar' ? 'م' : '#'}</th>
                        <th style="padding: 12px; text-align: ${getLang() === 'ar' ? 'right' : 'left'};">${getLang() === 'ar' ? 'الفريق' : 'Team'}</th>
                        <th style="padding: 12px; text-align: center;" class="hide-mobile">${getLang() === 'ar' ? 'ل' : 'P'}</th>
                        <th style="padding: 12px; text-align: center;" class="hide-mobile">${getLang() === 'ar' ? 'ف' : 'W'}</th>
                        <th style="padding: 12px; text-align: center;" class="hide-mobile">${getLang() === 'ar' ? 'ت' : 'D'}</th>
                        <th style="padding: 12px; text-align: center;">${getLang() === 'ar' ? 'خ' : 'L'}</th>
                        <th style="padding: 12px; text-align: center;">${getLang() === 'ar' ? 'نقاط' : 'Points'}</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    standings.forEach((team, index) => {
        const isHomeTeam = team.team?.id === homeTeamId;
        const isAwayTeam = team.team?.id === awayTeamId;
        const isHighlighted = isHomeTeam || isAwayTeam;
        
        // ✅ HIGHLIGHTING: Different colors for home/away teams
        let highlightStyle = '';
        if (isHomeTeam) {
            highlightStyle = 'background: rgba(59, 130, 246, 0.15); border-inline-start: 4px solid var(--primary); font-weight: bold;';
        } else if (isAwayTeam) {
            highlightStyle = 'background: rgba(239, 68, 68, 0.12); border-inline-start: 4px solid var(--live); font-weight: bold;';
        }
        
        standingsHTML += `
            <tr style="border-bottom: 1px solid var(--border); ${highlightStyle}">
                <td style="padding: 12px; text-align: center; font-weight: bold;">${team.rank || index + 1}</td>
                <td style="padding: 12px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ${team.team?.logo ? `<img src="${escapeHTML(team.team.logo)}" alt="${escapeHTML(team.team.name)}" style="width: 20px; height: 20px; object-fit: contain;">` : ''}
                        <span style="color: var(--text-main); font-weight: ${isHighlighted ? 'bold' : 'normal'};">${escapeHTML(team.team?.name || '')}</span>
                    </div>
                </td>
                <td style="padding: 12px; text-align: center;" class="hide-mobile">${team.all?.played || 0}</td>
                <td style="padding: 12px; text-align: center;" class="hide-mobile">${team.all?.win || 0}</td>
                <td style="padding: 12px; text-align: center;" class="hide-mobile">${team.all?.draw || 0}</td>
                <td style="padding: 12px; text-align: center;" class="hide-mobile">${team.all?.lose || 0}</td>
                <td style="padding: 12px; text-align: center; font-weight: bold; color: ${isHighlighted ? (isHomeTeam ? 'var(--primary)' : 'var(--live)') : 'var(--text-main)'};">${team.points || 0}</td>
            </tr>
        `;
    });
    
    standingsHTML += `
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = standingsHTML;
}

function renderStatistics(stats) {
    const container = document.getElementById('panelStatistics');
    if (!container) return;
    
    // ✅ STATISTICS TRANSLATIONS: Multilingual support
    const statTranslations = {
        'Ball Possession': getLang() === 'ar' ? 'الاستحواذ' : 'Ball Possession',
        'Total Shots': getLang() === 'ar' ? 'إجمالي التسديدات' : 'Total Shots',
        'Shots on Goal': getLang() === 'ar' ? 'تسديدات على المرمى' : 'Shots on Goal',
        'Corner Kicks': getLang() === 'ar' ? 'ركلات ركنية' : 'Corner Kicks',
        'Fouls': getLang() === 'ar' ? 'أخطاء' : 'Fouls',
        'Yellow Cards': getLang() === 'ar' ? 'بطاقات صفراء' : 'Yellow Cards',
        'Red Cards': getLang() === 'ar' ? 'بطاقات حمراء' : 'Red Cards',
        'Offsides': getLang() === 'ar' ? 'تسلل' : 'Offsides',
        'Goal Kicks': getLang() === 'ar' ? 'ركلات مرمى' : 'Goal Kicks',
        'Throw Ins': getLang() === 'ar' ? 'رميات ترابية' : 'Throw Ins',
        'Free Kicks': getLang() === 'ar' ? 'ركلات حرة' : 'Free Kicks',
        'Shots off Goal': getLang() === 'ar' ? 'تسديدات خارج المرمى' : 'Shots off Goal',
        'Blocked Shots': getLang() === 'ar' ? 'تسديدات محجوبة' : 'Blocked Shots',
        'Shots insidebox': getLang() === 'ar' ? 'تسديدات داخل منطقة الجزاء' : 'Shots insidebox',
        'Shots outsidebox': getLang() === 'ar' ? 'تسديدات خارج منطقة الجزاء' : 'Shots outsidebox',
        'Passes accurate': getLang() === 'ar' ? 'تمريرات دقيقة' : 'Passes accurate',
        'Total passes': getLang() === 'ar' ? 'إجمالي التمريرات' : 'Total passes',
        'Passes %': getLang() === 'ar' ? 'نسبة التمريرات' : 'Passes %',
        'expected_goals': getLang() === 'ar' ? 'الأهداف المتوقعة' : 'expected_goals'
    };
    
    // ✅ STATISTICS CLARITY: Get team names from current match
    const homeTeamName = escapeHTML(window.currentMatch?.teams?.home?.name || 'Home');
    const awayTeamName = escapeHTML(window.currentMatch?.teams?.away?.name || 'Away');
    
    let statsHTML = '';
    stats.forEach(stat => {
        let homeValue = stat.statistics?.[0]?.value || 0;
        let awayValue = stat.statistics?.[1]?.value || 0;
        
        // Strip % character from possession values before calculating
        if (typeof homeValue === 'string' && homeValue.includes('%')) {
            homeValue = parseFloat(homeValue.replace('%', ''));
        }
        if (typeof awayValue === 'string' && awayValue.includes('%')) {
            awayValue = parseFloat(awayValue.replace('%', ''));
        }
        
        // Convert to numbers for calculation
        homeValue = parseFloat(homeValue) || 0;
        awayValue = parseFloat(awayValue) || 0;
        
        // Calculate percentage for progress bars
        const total = homeValue + awayValue || 1;
        const homePercent = (homeValue / total * 100).toFixed(1);
        const awayPercent = (awayValue / total * 100).toFixed(1);
        
        // ✅ TRANSLATE STAT TYPE: Use dictionary
        const translatedType = statTranslations[stat.type] || stat.type;
        
        statsHTML += `
            <div class="stat-item" style="margin-bottom: 15px; background: var(--bg-elevated); border-radius: 6px; padding: 15px;">
                <div class="stat-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span class="stat-type" style="color: var(--text-main); font-weight: 600;">${translatedType}</span>
                </div>
                <div class="stat-bars" style="display: flex; gap: 10px; align-items: center;">
                    <div class="stat-team" style="flex: 1; text-align: center;">
                        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 3px;">${homeTeamName}</div>
                        <div class="stat-value" style="color: var(--text-main); font-weight: bold; margin-bottom: 5px;">${homeValue}${stat.type.includes('Possession') ? '%' : ''}</div>
                        <div class="stat-progress-bg" style="background: var(--bg-card); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div class="stat-progress-fill" style="background: var(--primary); height: 100%; width: ${homePercent}%; transition: width 0.3s ease;"></div>
                        </div>
                        <div class="stat-percent" style="color: var(--text-muted); font-size: 12px; margin-top: 3px;">${homePercent}%</div>
                    </div>
                    <div class="stat-team" style="flex: 1; text-align: center;">
                        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 3px;">${awayTeamName}</div>
                        <div class="stat-value" style="color: var(--text-main); font-weight: bold; margin-bottom: 5px;">${awayValue}${stat.type.includes('Possession') ? '%' : ''}</div>
                        <div class="stat-progress-bg" style="background: var(--bg-card); height: 8px; border-radius: 4px; overflow: hidden;">
                            <div class="stat-progress-fill" style="background: var(--live); height: 100%; width: ${awayPercent}%; transition: width 0.3s ease;"></div>
                        </div>
                        <div class="stat-percent" style="color: var(--text-muted); font-size: 12px; margin-top: 3px;">${awayPercent}%</div>
                    </div>
                </div>
            </div>
        `;
    });
    
    statsHTML += `
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = statsHTML;
}

function getEventIcon(type) {
    const icons = {
        'Goal': '⚽',
        'Yellow Card': '🟨',
        'Red Card': '🟥',
        'Substitution': '🔄',
        'Var': '📹'
    };
    return icons[type] || '📋';
}
function autoScrollToAI() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const analyze = params.get('analyze');

    if (tab) {
        // ✅ tab=ai / tab=events / tab=lineups / tab=statistics all supported
        setActiveTab(tab);
        setTimeout(() => {
            const panel = document.getElementById(`panel${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
    } else if (analyze === 'true') {
        // legacy param support
        setActiveTab('ai');
        setTimeout(() => {
            const aiSection = document.querySelector('#panelAi');
            if (aiSection) aiSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
    }
}

// ✅ RENDER MATCH UI
function renderMatchDetails(match, container) {
    // ✅ NULL GUARDS: Prevent crashes with missing match data
    if (!match || !match.teams || !match.teams.home || !match.teams.away) {
        container.innerHTML = `<p class='error'>${getTranslation("notFound")}</p>`;
        return;
    }

    const statusShort = match.fixture?.status?.short;
    let statusText = getTranslation("notStarted");
    let statusClass = "status";

    if (["FT", "AET", "PEN"].includes(statusShort)) {
        statusText = getTranslation("finished");
        statusClass = "status-finished";
    } else if (statusShort === "LIVE" || ["1H", "2H", "HT", "ET", "P1", "P2"].includes(statusShort)) {
        statusText = getTranslation("live");
        statusClass = "status-live";
    } else if (statusShort === "PST" || statusShort === "CANC") {
        statusText = getTranslation("postponed");
        statusClass = "status-postponed";
    }

    // ✅ SAFE SCORE HANDLING: Prevent crashes with missing goals
    const homeGoals = match?.goals?.home ?? 0;
    const awayGoals = match?.goals?.away ?? 0;
    const scoreDisplay = statusShort === "NS" ? "vs" : `${homeGoals} - ${awayGoals}`;

    // ✅ SAFE TIME HANDLING: Return Local Actual Time
    const matchTime = match?.fixture?.date ? 
        new Date(match.fixture.date).toLocaleTimeString(getLang() === 'ar' ? 'ar-SA' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            day: 'numeric',
            month: 'short'
        }) : getTranslation("notStarted");

    // Create match header and prepend it to the container (before tabs)
    const matchHeader = document.createElement('div');
    matchHeader.className = 'match-detail-header-container';
    matchHeader.innerHTML = `
        <div class="match-league-strip">
            <div class="match-detail-league">
                <span>${escapeHTML(match?.league?.name || 'Unknown League')}</span>
                <span class="match-detail-time">${matchTime}</span>
            </div>
        </div>
        <div class="match-detail-teams">
            <div class="team">
                <img src="${escapeHTML(match?.teams?.home?.logo || '')}" alt="${escapeHTML(match?.teams?.home?.name || 'Home')}" loading="lazy" onerror="handleImageError(this)" />
                <span>${escapeHTML(match?.teams?.home?.name || 'Home')}</span>
            </div>
            <div class="score-section">
                <div class="score">${statusShort === "NS" ? "VS" : `${(match?.goals?.home ?? 0)} - ${(match?.goals?.away ?? 0)}`}</div>
                <div class="${statusClass}">${statusText}</div>
            </div>
            <div class="team">
                <img src="${escapeHTML(match?.teams?.away?.logo || '')}" alt="${escapeHTML(match?.teams?.away?.name || 'Away')}" loading="lazy" onerror="handleImageError(this)" />
                <span>${escapeHTML(match?.teams?.away?.name || 'Away')}</span>
            </div>
        </div>
    `;
    
    // Clear container and add header, then tabs (which should already be in HTML)
    container.innerHTML = '';
    container.appendChild(matchHeader);
    
    // ✅ SMART TAB VISIBILITY: Check league type and hide standings if cup/no data
    const standingsTab = document.getElementById('tabMatches');
    if (standingsTab) {
        const leagueType = match.league?.type;
        const isCup = leagueType === 'Cup' || leagueType === 'cup';
        
        if (isCup) {
            standingsTab.style.display = 'none';
            console.log('🏆 Standings tab hidden - Cup competition');
        } else {
            standingsTab.style.display = '';
            console.log('📊 Standings tab visible - League competition');
        }
    }
}

// ✅ ENHANCED AI ANALYSIS: Async with loading state and enhanced error handling

// ============================================================
// 🤖 SMART MATCH ANALYZER — يتغير مع الإحصائيات الحقيقية
// ============================================================
let _aiAutoRefreshTimer = null;
let _aiLastHash = null;

async function renderAIPrediction(match) {
    const container = document.getElementById('aiPredictionContainer');
    if (!container) return;

    if (!match?.teams?.home?.name || !match?.teams?.away?.name) {
        container.innerHTML = _aiErrorHTML(getLang() === 'ar' ? 'بيانات المباراة غير متوفرة' : 'Match data unavailable');
        return;
    }

    const status = match?.fixture?.status?.short;
    if (['FT', 'AET', 'PEN'].includes(status)) {
        container.innerHTML = `<div class="ai-wrap">
            <div class="ai-title-row"><span class="ai-title-icon">🤖</span><h3>${getTranslation('aiPrediction')}</h3></div>
            <div class="ai-finished-msg">
                <span>🏁</span>
                <p>${getLang() === 'ar' ? 'انتهت المباراة — التحليل للمباريات القادمة والمباشرة فقط' : 'Match ended — analysis for upcoming & live matches only'}</p>
            </div>
        </div>`;
        aiRendered = true;
        return;
    }

    _showAILoading(container, match);
    await _doFetchAndRender(match, container);
}

function _showAILoading(container, match) {
    const isAr = getLang() === 'ar';
    container.innerHTML = `<div class="ai-wrap">
        <div class="ai-title-row">
            <span class="ai-title-icon">🤖</span>
            <h3>${getTranslation('aiPrediction')}</h3>
        </div>
        <div class="ai-loading-state">
            <div class="ai-dots"><span></span><span></span><span></span></div>
            <p>${isAr ? 'جاري تحليل الإحصائيات...' : 'Analyzing match statistics...'}</p>
        </div>
    </div>`;
}

async function _doFetchAndRender(match, container, isRefresh = false) {
    const matchId = match?.fixture?.id;
    if (!matchId) return;

    try {
        const resp = await fetch(`/api/match/analysis/${matchId}?lang=${getLang()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.finished) {
            container.innerHTML = `<div class="ai-wrap"><div class="ai-title-row"><span class="ai-title-icon">🤖</span><h3>${getTranslation('aiPrediction')}</h3></div>
                <div class="ai-finished-msg"><span>🏁</span><p>${getLang() === 'ar' ? 'انتهت المباراة' : 'Match ended'}</p></div></div>`;
            aiRendered = true; return;
        }
        if (!data.response?.[0]) throw new Error('No data');

        const pred = data.response[0].predictions;
        const meta = data.response[0].meta || {};
        const isLive = meta.isLive || false;
        const statsAvailable = meta.statsAvailable || false;

        const winner = pred.winner?.name || (getLang() === 'ar' ? 'تعادل متوقع' : 'Draw Expected');
        const advice = pred.advice || '';
        const pHome = pred.percent?.home ?? 40;
        const pDraw = pred.percent?.draw ?? 25;
        const pAway = pred.percent?.away ?? 35;
        const gHome = pred.goals?.home ?? 1;
        const gAway = pred.goals?.away ?? 1;
        const homeName = match.teams.home.name;
        const awayName = match.teams.away.name;
        const homeLogo = match.teams.home.logo || '';
        const awayLogo = match.teams.away.logo || '';
        const isAr = getLang() === 'ar';

        // Detect change
        const currentHash = `${pHome}-${pDraw}-${pAway}`;
        const changed = _aiLastHash && _aiLastHash !== currentHash;
        _aiLastHash = currentHash;

        // Status badge
        const badge = isLive
            ? `<span class="ai-badge ai-badge-live">🔴 ${isAr ? 'مباشر' : 'LIVE'}</span>`
            : `<span class="ai-badge ai-badge-pre">📅 ${isAr ? 'قبل المباراة' : 'Pre-Match'}</span>`;

        const changeBadge = changed
            ? `<span class="ai-badge ai-badge-updated">${isAr ? '✨ تحديث' : '✨ Updated'}</span>` : '';

        // Who dominates
        let dominanceBar = '';
        if (isLive && statsAvailable) {
            const hPct = Math.round(pHome / (pHome + pAway) * 100);
            dominanceBar = `<div class="ai-dominance-bar">
                <span class="ai-dom-label">${homeName}</span>
                <div class="ai-dom-track">
                    <div class="ai-dom-home" style="width:${hPct}%"></div>
                </div>
                <span class="ai-dom-label">${awayName}</span>
            </div>`;
        }

        // H2H
        let h2hHTML = '';
        try {
            const h2hRes = await fetch(`/api/match/h2h?h2h=${match.teams.home.id}-${match.teams.away.id}&last=5`);
            if (h2hRes.ok) {
                const h2hData = await h2hRes.json();
                const meetings = (h2hData?.response || []).slice(0, 5);
                if (meetings.length > 0) {
                    let homeW=0, draws=0, awayW=0;
                    meetings.forEach(m => {
                        if (m.goals.home > m.goals.away) homeW++;
                        else if (m.goals.away > m.goals.home) awayW++;
                        else draws++;
                    });
                    h2hHTML = `<div class="ai-h2h">
                        <div class="ai-h2h-header">
                            <span class="ai-section-label">⚔️ ${isAr ? 'آخر اللقاءات' : 'Head to Head'}</span>
                            <div class="ai-h2h-summary">
                                <span class="ai-h2h-win">${homeName} ${homeW}</span>
                                <span class="ai-h2h-draw">${isAr ? 'تعادل' : 'D'} ${draws}</span>
                                <span class="ai-h2h-win">${awayW} ${awayName}</span>
                            </div>
                        </div>
                        ${meetings.map(m => {
                            const d = new Date(m.fixture.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB', {day:'2-digit',month:'short',year:'2-digit'});
                            const hg = m.goals.home, ag = m.goals.away;
                            const winner = hg > ag ? 'home' : ag > hg ? 'away' : 'draw';
                            return `<div class="ai-h2h-row">
                                <span class="ai-h2h-date">${d}</span>
                                <span class="ai-h2h-team ${winner==='home'?'ai-h2h-bold':''}">${escapeHTML(m.teams.home.name)}</span>
                                <span class="ai-h2h-score">${hg} – ${ag}</span>
                                <span class="ai-h2h-team ${winner==='away'?'ai-h2h-bold':''}">${escapeHTML(m.teams.away.name)}</span>
                            </div>`;
                        }).join('')}
                    </div>`;
                }
            }
        } catch(e) {}

        container.innerHTML = `
        <div class="ai-wrap${changed ? ' ai-wrap-updated' : ''}">

            <!-- Header -->
            <div class="ai-title-row">
                <span class="ai-title-icon">🤖</span>
                <h3>${getTranslation('aiPrediction')}</h3>
                <div class="ai-badges">${badge}${changeBadge}</div>
            </div>

            <!-- Predicted Score -->
            <div class="ai-score-card">
                <div class="ai-score-team">
                    <img class="ai-logo" src="${homeLogo}" onerror="this.style.display='none'">
                    <span>${homeName}</span>
                </div>
                <div class="ai-score-box">
                    <div class="ai-score-nums">${gHome} – ${gAway}</div>
                    <div class="ai-score-sub">${isAr ? 'النتيجة المتوقعة' : 'Predicted Score'}</div>
                </div>
                <div class="ai-score-team">
                    <img class="ai-logo" src="${awayLogo}" onerror="this.style.display='none'">
                    <span>${awayName}</span>
                </div>
            </div>

            ${dominanceBar}

            <!-- Win Probability Bars -->
            <div class="ai-prob-block">
                <div class="ai-section-label">${isAr ? 'احتمالات الفوز' : 'Win Probability'}</div>
                ${_probBarHTML(homeName, pHome, '#3b82f6')}
                ${_probBarHTML(isAr ? 'تعادل' : 'Draw', pDraw, '#f59e0b')}
                ${_probBarHTML(awayName, pAway, '#ef4444')}
            </div>

            <!-- Winner Box -->
            <div class="ai-winner">
                <div class="ai-winner-label">🏆 ${isAr ? 'الأوفر حظاً' : 'Most Likely'}</div>
                <div class="ai-winner-name">${winner}</div>
                <div class="ai-winner-conf">${pHome > pAway + 5 ? pHome : pAway > pHome + 5 ? pAway : pDraw}% ${isAr ? 'احتمال' : 'chance'}</div>
            </div>

            <!-- AI Analysis Text -->
            <div class="ai-analysis-box">
                <div class="ai-section-label">📊 ${isAr ? 'قراءة المباراة' : 'Match Reading'}</div>
                <p class="ai-analysis-p">${advice}</p>
            </div>

            ${h2hHTML}

            <!-- Refresh button for live -->
            ${isLive ? `<button class="ai-refresh-btn" onclick="window._aiForceRefresh()">
                🔄 ${isAr ? 'تحديث التحليل' : 'Refresh Analysis'}
            </button>` : ''}

        </div>`;

        aiRendered = true;

        // Auto-refresh every 2.5 min for live matches
        if (isLive) {
            clearTimeout(_aiAutoRefreshTimer);
            _aiAutoRefreshTimer = setTimeout(() => {
                if (window.currentMatch) _doFetchAndRender(window.currentMatch, document.getElementById('aiPredictionContainer'), true);
            }, 150000);
        }

    } catch(err) {
        console.error('❌ AI render error:', err);
        if (!isRefresh) {
            container.innerHTML = `<div class="ai-wrap">
                <div class="ai-title-row"><span class="ai-title-icon">🤖</span><h3>${getTranslation('aiPrediction')}</h3></div>
                ${_aiErrorHTML(getLang() === 'ar' ? 'تعذّر تحميل التحليل' : 'Analysis unavailable', true)}
            </div>`;
        }
        aiRendered = false;
    }
}

function _probBarHTML(label, pct, color) {
    return `<div class="ai-prob-row">
        <span class="ai-prob-label">${label}</span>
        <div class="ai-prob-track"><div class="ai-prob-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="ai-prob-val">${pct}%</span>
    </div>`;
}

function _aiErrorHTML(msg, showRetry = false) {
    const retryBtn = showRetry ? `<button class="ai-retry-btn" onclick="window._aiForceRefresh()">${getLang()==='ar'?'حاول مرة أخرى':'Try Again'}</button>` : '';
    return `<div class="ai-error-state"><span>😔</span><p>${msg}</p>${retryBtn}</div>`;
}

window._aiForceRefresh = function() {
    aiRendered = false;
    _aiLastHash = null;
    clearTimeout(_aiAutoRefreshTimer);
    const container = document.getElementById('aiPredictionContainer');
    if (container && window.currentMatch) {
        _showAILoading(container, window.currentMatch);
        _doFetchAndRender(window.currentMatch, container, false);
    }
};


// ✅ EXPORT FUNCTIONS FOR GLOBAL ACCESS
window.setActiveTab = setActiveTab;
window.loadLineups = loadLineups;
window.loadEvents = loadEvents;
window.loadStatistics = loadStatistics;
window.autoScrollToAI = autoScrollToAI;

// ✅ INIT
document.addEventListener("DOMContentLoaded", () => {
    console.log('🚀 Match Detail Page Initialized');
    
    // ✅ APPLY LANGUAGE: Set translations and direction
    applyMatchPageLanguage();
    
    loadMatchDetails();
    
    // ✅ TAB EVENT LISTENERS: Handle tab clicks with error handling
    document.querySelectorAll('.match-detail-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            try {
                const tabId = e.target.getAttribute('data-tab');
                if (tabId) {
                    console.log(`🔄 Switching to tab: ${tabId}`);
                    setActiveTab(tabId);
                }
            } catch (error) {
                console.error('❌ Error switching tab:', error);
            }
        });
    });
});

// ✅ GLOBAL FUNCTIONS: Image fallback — neutral placeholder, never the site logo
window.handleImageError = function(img) {
    img.onerror = null;
    img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+PGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMjIiIGZpbGw9IiMxNjIzMzgiIHN0cm9rZT0iIzI1MzY1MSIgc3Ryb2tlLXdpZHRoPSIyIi8+PHBhdGggZD0iTTI0IDEyYTEyIDEyIDAgMSAwIDAgMjQgMTIgMTIgMCAwIDAgMC0yNHptMCAyMS41YTkuNSA5LjUgMCAxIDEgMC0xOSA5LjUgOS41IDAgMCAxIDAgMTl6IiBmaWxsPSIjNWU3Mzk0Ii8+PC9zdmc+';
    img.style.opacity = '0.5';
}
