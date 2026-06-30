const path = require('path');
const fs = require('fs');
// Force absolute path resolution to ensure .env is found in the project root
// Production Release - March 2026
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const axios = require('axios');
// cors package removed — replaced by custom ALLOWED_ORIGINS middleware below
const compression = require('compression');
const NodeCache = require('node-cache');
// express-rate-limit is kept as a dependency but not applied at the API level
// on Vercel Serverless (see comment below where apiRateLimit was).
const translate = require('google-translate-api-next');
const helmet = require('helmet');

// ✅ PERMANENT STORAGE: Vercel KV with local fallback
let kv = null;
if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
  try {
    kv = require('@vercel/kv');
    console.log('🔗 Vercel KV connected - Permanent storage enabled');
  } catch (error) {
    console.log('⚠️ Vercel KV not available, falling back to local storage');
  }
} else {
  console.log('📁 Local development - Using file-based storage');
}

const app = express();
const PORT = process.env.PORT || 3001;

// ✅ PERFORMANCE: Compression must be the very first middleware so it applies
// to all responses — including static files served by express.static — before
// any other middleware or route handlers run.
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  threshold: 1024,
}));

// ✅ CRASH PROTECTION: Without these, ANY unexpected error anywhere in the 16
// async routes (e.g. malformed data from the upstream football API, an
// unexpected null somewhere) becomes an unhandled rejection/exception that can
// crash the entire Node process — taking the whole site down for every visitor,
// not just the one request that failed. Logging + staying alive is the correct
// behavior for a public web server; exiting on every unexpected error is not.
process.on('unhandledRejection', (reason, promise) => {
  console.error('🛑 UNHANDLED REJECTION (server stays alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🛑 UNCAUGHT EXCEPTION (server stays alive):', err.message, err.stack);
  // Intentionally NOT calling process.exit() here — for a stateless HTTP server,
  // logging and continuing is safer than crashing and losing all in-flight requests.
});

// Immediate environment verification
console.log("📂 Server Root Directory:", __dirname);
console.log("🔑 API Key Status:", process.env.FOOTBALL_API_KEY ? "✅ LOADED SUCCESSFULLY" : "❌ STILL MISSING");

// المفتاح يُقرأ حصرياً من البيئة ولا يُطبع أبداً في الـ log
const API_KEY = process.env.FOOTBALL_API_KEY;

if (API_KEY) {
  console.log("✅ API Key Validation: Verified");
} else {
  console.error("❌ API Key Validation: Failed");
  console.error("❌ FOOTBALL_API_KEY غير موجود في ملف .env");
  process.exit(1);
}

// ✅ DYNAMIC DATE SUPPORT: Get current date functions using Cairo timezone
// Vercel runs on UTC servers; without this, midnight cache refresh fires at
// 02:00 Cairo time (UTC+2) — two hours late for local users.
const CAIRO_TZ = 'Africa/Cairo';

function getDateStringInCairo(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  // toLocaleDateString with 'en-CA' gives ISO-format YYYY-MM-DD
  return now.toLocaleDateString('en-CA', { timeZone: CAIRO_TZ });
}

function getCurrentDateString()   { return getDateStringInCairo(0);  }
function getYesterdayDateString() { return getDateStringInCairo(-1); }
function getTomorrowDateString()  { return getDateStringInCairo(+1); }

// ✅ AUTO-REFRESH: Check if day has changed and clear cache
let lastKnownDate = getCurrentDateString();
function checkAndRefreshCache() {
  const currentDate = getCurrentDateString();
  if (lastKnownDate !== currentDate) {
    console.log(`🔄 Day changed from ${lastKnownDate} to ${currentDate}`);
    console.log('🧹 Clearing all cache for new day...');
    
    // Clear entire cache
    myCache.flushAll();
    
    // Update last known date
    lastKnownDate = currentDate;
    
    console.log('✅ Cache cleared for new day');
    return true; // Cache was refreshed
  }
  return false; // No refresh needed
}

// Check for day change every minute
setInterval(checkAndRefreshCache, 60000);

console.log(`🗓️ MatchLogic Live System Started`);
console.log(`📅 Current Date: ${getCurrentDateString()}`);
console.log(`📅 Yesterday: ${getYesterdayDateString()}`);
console.log(`📅 Tomorrow: ${getTomorrowDateString()}`);
console.log(`🔄 Auto-refresh enabled (every minute)`);
const myCache = new NodeCache({ 
  stdTTL: 86400, // 24 hours for fixtures and search results (was 5 minutes)
  checkperiod: 60 // Check for expired keys every minute
});

// Smart Team Cache for 24 hours
const teamCache = new NodeCache({ stdTTL: 86400 }); // 86400 seconds (24 hours)

// Translation Cache for 24 hours with memory protection
const translationCache = new NodeCache({ stdTTL: 86400, maxKeys: 5000 }); // Cache translations with key limit

// Request deduplication to prevent duplicate API calls
const pendingRequests = new Map();

// ✅ SECURITY: Input validation middleware for API routes
function validateInput(req, res, next) {
  const { date, league, teamId, from, to, id, query, q, h2h, last } = req.query;
  
  // Validate date format (YYYY-MM-DD)
  if (date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    // Validate it's a real date
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date value' });
    }

    // ✅ DATE RANGE GUARD: Reject requests outside ±30 days from today (Cairo time).
    // This prevents API quota abuse from scrapers fishing with random historical dates.
    // We compare using the ISO date string in Cairo TZ so the boundary shifts at
    // Cairo midnight — consistent with the rest of our date logic.
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: CAIRO_TZ }); // YYYY-MM-DD
    const todayMs  = new Date(todayStr).getTime();
    const reqMs    = new Date(date).getTime();
    const diffDays = (reqMs - todayMs) / (1000 * 60 * 60 * 24);
    if (diffDays < -30 || diffDays > 30) {
      return res.status(400).json({ error: 'Date out of allowed range. Only ±30 days from today are permitted.' });
    }
  }
  
  // Validate league parameter (must be a number)
  if (league) {
    const leagueNum = parseInt(league, 10);
    if (isNaN(leagueNum) || leagueNum <= 0) {
      return res.status(400).json({ error: 'Invalid league ID. Must be a positive number' });
    }
  }
  
  // Validate teamId parameter (must be a number)
  if (teamId) {
    const teamIdNum = parseInt(teamId, 10);
    if (isNaN(teamIdNum) || teamIdNum <= 0) {
      return res.status(400).json({ error: 'Invalid team ID. Must be a positive number' });
    }
  }
  
  // Validate from/to dates if provided
  if (from) {
    const fromRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!fromRegex.test(from)) {
      return res.status(400).json({ error: 'Invalid from date format. Use YYYY-MM-DD' });
    }
  }
  
  if (to) {
    const toRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!toRegex.test(to)) {
      return res.status(400).json({ error: 'Invalid to date format. Use YYYY-MM-DD' });
    }
  }
  
  // Validate id parameter (must be a number)
  if (id) {
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'Invalid match ID. Must be a positive number' });
    }
  }
  
  // Sanitize text queries (query, q, h2h)
  const sanitizeText = (text) => {
    if (!text || typeof text !== 'string') return '';
    // Remove potentially dangerous characters while preserving Arabic/English
    return text
      .trim()
      .slice(0, 100) // Limit length
      .replace(/[<>\"'']/g, ''); // Remove HTML/JS injection characters
  };
  
  if (query) {
    req.query.query = sanitizeText(query);
  }
  
  if (q) {
    req.query.q = sanitizeText(q);
  }
  
  if (h2h) {
    req.query.h2h = sanitizeText(h2h);
  }
  
  // Validate last parameter (must be a positive number if provided)
  if (last) {
    const lastNum = parseInt(last, 10);
    if (isNaN(lastNum) || lastNum <= 0 || lastNum > 100) {
      return res.status(400).json({ error: 'Invalid last parameter. Must be a number between 1 and 100' });
    }
  }
  
  next();
}

// Arabic detection function
function isArabic(text) {
  const arabicRegex = /[\u0600-\u06FF]/;
  return arabicRegex.test(text);
}

// Translate Arabic to English with caching
async function translateArabicToEnglish(arabicText) {
  if (!isArabic(arabicText)) {
    return arabicText; // Return as-is if not Arabic
  }

  // Check cache first
  const cacheKey = `translate-${arabicText}`;
  const cachedTranslation = translationCache.get(cacheKey);
  if (cachedTranslation) {
    console.log(`⚡ Translation from cache: "${arabicText}" -> "${cachedTranslation}"`);
    return cachedTranslation;
  }

  try {
    console.log(`🌐 Translating: "${arabicText}"`);
    const result = await translate(arabicText, { from: 'ar', to: 'en' });
    const translatedText = result.text;
    
    // Cache the translation
    translationCache.set(cacheKey, translatedText);
    console.log(`✅ Translated: "${arabicText}" -> "${translatedText}"`);
    
    return translatedText;
  } catch (error) {
    console.error(`❌ Translation failed for "${arabicText}":`, error.message);
    // Fallback: Return original text if translation fails
    return arabicText;
  }
}

// Hierarchical caching strategy with intelligent TTL
const CACHE_STRATEGY = {
  live_matches: 120 * 1000,           // 120 seconds (2 minutes) for live matches
  finished_matches: 86400 * 1000,     // 24 hours for finished matches (results never change)
  team_data: 86400 * 1000,            // 86400 seconds (24 hours) for team data
  league_data: 86400 * 1000           // 86400 seconds (24 hours) for league data
};

// Request deduplication function
async function deduplicateRequest(key, apiCall) {
  if (pendingRequests.has(key)) {
    console.log(`🔄 Request deduplicated: ${key}`);
    return pendingRequests.get(key);
  }
  const promise = apiCall();
  pendingRequests.set(key, promise);
  promise.finally(() => pendingRequests.delete(key));
  return promise;
}


// Remove Express default headers for security
app.disable('x-powered-by');

// Fix rate limiting IPv6 issue
// Add security headers and rate limiting

// ✅ SITEMAP: Generates a real static XML file at public/sitemap.xml so Chrome
// receives it via express.static with the correct Content-Type — bypassing all
app.get('/sitemap.xml', async (req, res) => {
  const base = 'https://matchlogic-server.vercel.app';
  const today = getCurrentDateString();
  const yesterday = getYesterdayDateString();
  const tomorrow = getTomorrowDateString();

  const url = (loc, lastmod, freq, priority) => `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;

  let matchUrls = '';
  try {
    const data = await fetchFromAPI('fixtures', { date: today });
    const matches = data?.response || [];
    matchUrls = matches.slice(0, 150).map(m => {
      const id = m.fixture?.id;
      if (!id) return '';
      const lastmod = m.fixture?.date ? m.fixture.date.split('T')[0] : today;
      return url(`${base}/match.html?id=${id}`, lastmod, 'hourly', '0.8');
    }).join('');
  } catch (e) {
    console.error('⚠️ Sitemap fetch failed:', e.message);
  }

  // بناء السايت ماب في سطر واحد مضغوط لضمان عدم وجود فراغات
  let sitemap = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
  sitemap += url(`${base}/`, today, 'daily', '1.0');
  sitemap += url(`${base}/match.html`, today, 'hourly', '0.9');
  sitemap += url(`${base}/?date=${yesterday}`, yesterday, 'daily', '0.6');
  sitemap += url(`${base}/?date=${tomorrow}`, tomorrow, 'daily', '0.7');
  sitemap += matchUrls;
  sitemap += '</urlset>';

  res.header('Content-Type', 'application/xml; charset=utf-8');
  res.header('X-Content-Type-Options', 'nosniff');
  res.status(200).send(sitemap);
});


app.use(helmet({
  frameguard: false,
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "frame-ancestors": ["'self'"],
      "img-src": ["'self'", "data:", "https://*.api-sports.io", "https://*.wikimedia.org", "https://cdn-icons-png.flaticon.com"],
      "script-src": ["'self'", "'unsafe-inline'", "https://pagead2.googlesyndication.com"],
      "script-src-attr": ["'unsafe-inline'"],
      "connect-src": ["'self'", "https://pagead2.googlesyndication.com", "https://fonts.googleapis.com"],
      "frame-src": ["'self'", "https://googleads.g.doubleclick.net", "https://*.googlesyndication.com"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
    },
  },
}));

app.set('trust proxy', 1);

// Set proper cache headers for static vs dynamic assets
app.use('/css/', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year for CSS
  next();
});

app.use('/js/', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year for JS
  next();
});

app.use('/icons/', (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year for icons
  next();
});

app.use('/api/', (req, res, next) => {
  // ✅ VERCEL EDGE CDN: s-maxage lets the Vercel Edge cache serve repeated
  // requests from CDN without hitting the serverless function at all.
  // stale-while-revalidate=120 means the Edge serves the stale copy instantly
  // while refreshing in the background — this is the key fix for Cache Stampede:
  // concurrent visitors get the cached response instead of all hammering the
  // origin at once. The existing in-process NodeCache + KV still serve as the
  // second layer for data freshness.
  // NOTE: Live-match endpoints override this with shorter TTLs via their own headers.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  res.setHeader('Pragma', 'no-cache'); // kept for legacy proxy compatibility
  next();
});

// ✅ SECURITY: Stress test bypass only in development mode
// ℹ️ express-rate-limit intentionally removed for Vercel Serverless.
// In a serverless environment each request can be handled by a different
// isolated instance that shares no memory, so an in-process counter gives
// no real protection against abuse — but it CAN incorrectly block legitimate
// users when multiple requests land on the same warm instance.
// Real traffic protection on Vercel is handled at the Edge/Firewall level.

app.use('/api/', (req, res, next) => next()); // placeholder so route order is unchanged

// ✅ SECURITY: Restricted CORS — only allow our own Vercel deployment + local dev.
// The previous `cors()` with no config accepted requests from ANY origin, which
// allows third-party sites to silently consume our API quota.
// Requests with no Origin header (curl, Postman, server-to-server) are allowed
// through — those tools don't send an Origin and aren't subject to CORS policy.
const ALLOWED_ORIGINS = [
  'https://matchlogic-server.vercel.app',
  'http://localhost:3001',
  'http://localhost:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3000',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    // No Origin header — direct request (curl, Postman, SSR). Allow through.
    return next();
  }
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  }
  // Origin present but not in whitelist — reject
  console.warn(`🚫 CORS blocked: ${origin}`);
  return res.status(403).json({ error: 'Origin not allowed' });
});

app.use(express.json());

// ✅ SECURITY: Apply input validation to API routes
app.use('/api/search', validateInput);
app.use('/api/matches', validateInput);
app.use('/api/structured-data', validateInput);
app.use('/api/match/h2h', validateInput);
app.use('/api/teams/search', validateInput);
app.use('/api/team-schedule', validateInput);

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve robots.txt from root
app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

const BASE_URL = "https://v3.football.api-sports.io";
// API_KEY already loaded above

// ✅ TEAM_DICT: Static translation map for popular teams — accelerates search
// without consuming API quota. Keys are lowercase Arabic/English aliases.
const TEAM_DICT = {
  // عربي
  'الأهلي': { id: 8634, name: 'Al Ahly', country: 'Egypt' },
  'الزمالك': { id: 8633, name: 'Zamalek', country: 'Egypt' },
  'الهلال': { id: 2932, name: 'Al Hilal', country: 'Saudi Arabia' },
  'النصر': { id: 2931, name: 'Al Nassr', country: 'Saudi Arabia' },
  'الاتحاد': { id: 7834, name: 'Al Ittihad', country: 'Saudi Arabia' },
  'الأهلي السعودي': { id: 7835, name: 'Al Ahli Saudi', country: 'Saudi Arabia' },
  'برشلونة': { id: 529, name: 'FC Barcelona', country: 'Spain' },
  'ريال مدريد': { id: 541, name: 'Real Madrid', country: 'Spain' },
  'مانشستر سيتي': { id: 50, name: 'Manchester City', country: 'England' },
  'مانشستر يونايتد': { id: 33, name: 'Manchester United', country: 'England' },
  'ليفربول': { id: 40, name: 'Liverpool', country: 'England' },
  'ارسنال': { id: 42, name: 'Arsenal', country: 'England' },
  'تشيلسي': { id: 49, name: 'Chelsea', country: 'England' },
  'بايرن ميونخ': { id: 157, name: 'Bayern München', country: 'Germany' },
  'باريس سان جيرمان': { id: 85, name: 'PSG', country: 'France' },
  'يوفنتوس': { id: 496, name: 'Juventus', country: 'Italy' },
  // English aliases
  'al ahly': { id: 8634, name: 'Al Ahly', country: 'Egypt' },
  'zamalek': { id: 8633, name: 'Zamalek', country: 'Egypt' },
  'al hilal': { id: 2932, name: 'Al Hilal', country: 'Saudi Arabia' },
  'al nassr': { id: 2931, name: 'Al Nassr', country: 'Saudi Arabia' },
  'barcelona': { id: 529, name: 'FC Barcelona', country: 'Spain' },
  'real madrid': { id: 541, name: 'Real Madrid', country: 'Spain' },
  'manchester city': { id: 50, name: 'Manchester City', country: 'England' },
  'manchester united': { id: 33, name: 'Manchester United', country: 'England' },
  'liverpool': { id: 40, name: 'Liverpool', country: 'England' },
  'arsenal': { id: 42, name: 'Arsenal', country: 'England' },
  'chelsea': { id: 49, name: 'Chelsea', country: 'England' },
  'bayern': { id: 157, name: 'Bayern München', country: 'Germany' },
  'psg': { id: 85, name: 'PSG', country: 'France' },
  'juventus': { id: 496, name: 'Juventus', country: 'Italy' },
};

// ✅ fetchWithRetry: Wraps axios with up to 3 attempts + 8s timeout per attempt.
// Critical for Cold Start scenarios on Vercel where the first request can be slow.
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, { timeout: 8000, ...options });
      return response;
    } catch (err) {
      lastError = err;
      const isLast = attempt === maxRetries;
      console.warn(`⚠️ fetchWithRetry attempt ${attempt}/${maxRetries} failed: ${err.message}${isLast ? ' — giving up' : ' — retrying...'}`);
      if (!isLast) await new Promise(r => setTimeout(r, 500 * attempt)); // backoff
    }
  }
  throw lastError;
}

async function fetchFromAPI(endpoint, params = {}, useCache = true, priority = 'normal') {
  const cacheKey = endpoint + JSON.stringify(params);
  
  // Check cache first — NodeCache (fast, in-memory) then KV (persistent, survives cold starts)
  if (useCache) {
    // 1. In-memory cache (fastest — no network hop)
    const cachedData = myCache.get(cacheKey);
    if (cachedData) {
      console.log("⚡ من الكاش:", endpoint);
      return cachedData;
    }

    // 2. Vercel KV (persistent across cold starts — only on Vercel)
    if (kv) {
      try {
        const kvData = await kv.get(cacheKey);
        if (kvData) {
          console.log("⚡ KV cache hit:", endpoint);
          // Warm the in-memory cache too so the next request in this instance is instant
          myCache.set(cacheKey, kvData, 300);
          return kvData;
        }
      } catch (kvErr) {
        console.log('⚠️ KV read error (non-fatal):', kvErr.message);
      }
    }
  }

  // Use request deduplication
  const requestKey = `${endpoint}-${JSON.stringify(params)}`;
  return deduplicateRequest(requestKey, async () => {
    try {
      if (useCache) console.log("🌍 طلب جديد:", endpoint);

      // Build full URL for logging
      const fullUrl = `${BASE_URL}/${endpoint}?${new URLSearchParams(params).toString()}`;
      
      // ✅ PRODUCTION LOGGING: Only log in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('🌐 Full API URL:', fullUrl);
        console.log('🔑 Using API Key:', API_KEY ? 'Present' : 'Missing');
      }

      // ✅ FIXED: Use DIRECT API-SPORTS HEADERS ONLY (no RapidAPI — account does not exist)
      const response = await fetchWithRetry(
        `${BASE_URL}/${endpoint}`,
        {
          params,
          headers: {
            'x-apisports-key': API_KEY,
            'User-Agent': 'MatchLogic/1.0',
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate'
          }
        }
      );
      console.log('✅ API-Sports request successful');

      const data = response.data;
      
      // ✅ PRODUCTION LOGGING: Only log raw data in development
      if (process.env.NODE_ENV !== 'production') {
        console.log('🔍 === RAW API DATA START ===');
        console.log('🔍 Endpoint:', endpoint);
        console.log('🔍 Parameters:', params);
        console.log('🔍 Status:', response.status);
        console.log('🔍 Status Text:', response.statusText);
        console.log('🔍 Full Response Data:', JSON.stringify(data, null, 2));
        console.log('🔍 === RAW API DATA END ===');
      } else {
        // ✅ PRODUCTION: Minimal logging
        console.log(`✅ API Success: ${endpoint} (${data.response?.length || 0} results)`);
      }
      
      // Smart caching based on content type - ONLY cache successful, non-empty data
      if (useCache) {
        let ttl = 300; // Default 5 minutes
        
        // Determine TTL based on endpoint and content
        if (endpoint === 'fixtures') {
          const hasLiveMatches = data.response?.some(match => {
            const status = match.fixture?.status?.short;
            return status && status !== 'NS' && status !== 'FT' && status !== 'AET' && status !== 'PEN' && status !== 'PST';
          });
          ttl = hasLiveMatches ? CACHE_STRATEGY.live_matches / 1000 : CACHE_STRATEGY.finished_matches / 1000;
        } else if (endpoint === 'teams') {
          ttl = CACHE_STRATEGY.team_data / 1000;
        } else if (endpoint.includes('league')) {
          ttl = CACHE_STRATEGY.league_data / 1000;
        } else if (endpoint === 'standings') {
          ttl = 86400; // 24h for standings
        }
        
        // ONLY cache if data is successful and non-empty
        if (data.response && data.response.length > 0) {
          myCache.set(cacheKey, data, ttl);
          console.log(`💾 Cached ${endpoint} with TTL: ${ttl}s (${data.response.length} results)`);
          // Also write to KV for persistence across cold starts
          if (kv) {
            await kv.set(cacheKey, data, { ex: ttl }).catch(e =>
              console.log('⚠️ KV write error (non-fatal):', e.message)
            );
          }
        } else {
          console.log(`⚠️ Skipped caching ${endpoint} - empty or invalid response (${data.response?.length || 0} results)`);
        }
      }
      
      return data;

    } catch (error) {
      // ✅ ENHANCED ERROR HANDLING: Distinguish network vs response errors
      if (error.response) {
        console.error('❌ API Error Response:', error.response.status, error.response.data);
      } else if (error.request) {
        console.error('❌ No response received:', error.message);
        console.error('❌ Request details:', error.request);
      } else {
        console.error('❌ Axios config error:', error.message);
      }
      
      // Don't cache errors
      if (error.response?.status === 401) {
        console.error('❌ API Key invalid or expired');
      } else if (error.response?.status === 429) {
        console.error('❌ Rate limit exceeded');
      }
      
      return {};
    }
  });
}

async function fetchTeamDetails(teamId) {
  const cacheKey = `team-${teamId}`;
  
  // Check team cache first (24 hours TTL)
  let teamData = teamCache.get(cacheKey);
  if (teamData) {
    console.log("⚡ Team from cache:", teamId);
    return teamData;
  }
  
  try {
    // ✅ FIXED: response.data doesn't exist, use response directly
    const response = await fetchFromAPI('teams', { id: teamId }, false);
    teamData = response.response?.[0] || {};
    if (teamData) {
      // Cache team data for 24 hours
      teamCache.set(cacheKey, teamData);
      console.log("💾 Cached team data for:", teamId);
    } else {
      console.log("⚠️ Skipped caching teams - 0 results for teamId:", teamId);
    }
    return teamData;
  } catch (error) {
    console.error("❌ Team fetch error:", error.message);
    return {};
  }
}

////////////////////////////////////////////////////
// 🔍 Team Search API - Deep Audit Mode
////////////////////////////////////////////////////
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.json({ response: [] });
    }

    // ✅ TEAM_DICT fast path: instant results for popular teams without API call
    const dictHit = TEAM_DICT[query.trim().toLowerCase()];
    if (dictHit) {
      console.log(`⚡ TEAM_DICT hit for: "${query}"`);
      return res.json({ response: [{ team: dictHit }] });
    }
    
    console.log(`🔍 === SEARCH AUDIT START ===`);
    console.log(`🔍 Original Query: "${query}"`);
    
    // ✅ FIXED: URL-encode the query for API-Sports
    const encodedQuery = encodeURIComponent(query);
    console.log(`🔍 Encoded Query: "${encodedQuery}"`);
    
    // Translate Arabic to English if needed
    let searchQuery = query;
    if (isArabic(query)) {
      searchQuery = await translateArabicToEnglish(query);
      console.log(`🌐 Translation: "${query}" -> "${searchQuery}"`);
    } else {
      console.log(`📝 English query (no translation needed): "${query}"`);
    }
    
    console.log(`🔍 Final Search Query: "${searchQuery}"`);
    
    // ✅ CLEAN SEARCH INPUT: Sanitize search query for API compatibility
    searchQuery = sanitizeSearchQuery(searchQuery);
    console.log(`🧹 Sanitized Search Query: "${searchQuery}"`);
    
    // ✅ ENHANCED: Forward to API-Sports teams endpoint with proper encoding
    console.log(`🔍 Calling API with params: { search: "${searchQuery}" }`);
    
    // ✅ DEBUG: Log the FULL URL being sent to API-Sports
    const fullApiUrl = `${BASE_URL}/teams?search=${encodeURIComponent(searchQuery)}`;
    console.log('🌐 FULL API URL to API-Sports:', fullApiUrl);
    console.log('🔑 API Key Status:', API_KEY ? 'Present' : 'Missing');
    
    const data = await fetchFromAPI('teams', { search: searchQuery });
    
    // ✅ DEBUG: Log API response details
    console.log('🔍 API Response Status:', data ? 'Success' : 'Failed');
    console.log('🔍 API Response Length:', data?.response?.length || 0);
    if (data?.response && data.response.length > 0) {
      console.log('🔍 First API Result:', JSON.stringify(data.response[0], null, 2));
    }
    
    // ✅ ENHANCED: Fallback to local cache if API returns empty
    if (!data.response || data.response.length === 0) {
      console.log(`🔍 API returned empty results, trying local cache fallback...`);
      
      // ✅ ARABIC FALLBACK: Search in cached matches for Arabic string
      const localResults = searchInLocalCache(searchQuery);
      if (localResults.length > 0) {
        console.log(`🔍 Found ${localResults.length} teams in local cache for Arabic search`);
        return res.json({ response: localResults });
      }
      
      // ✅ SECOND FALLBACK: Try original Arabic query in local cache
      const arabicResults = searchInLocalCache(query);
      if (arabicResults.length > 0) {
        console.log(`🔍 Found ${arabicResults.length} teams in local cache for original Arabic query`);
        return res.json({ response: arabicResults });
      }
    }
    
    console.log(`🔍 === SEARCH AUDIT END ===`);
    console.log(`🔍 Final Results Count: ${data.response?.length || 0}`);
    
    res.json(data);

  } catch (error) {
    console.error('❌ === SEARCH ERROR AUDIT ===');
    console.error('❌ Search error:', error.message);
    console.error('❌ Error details:', error.response?.data || 'No response data');
    console.error('❌ === SEARCH ERROR AUDIT END ===');
    res.json({ response: [] });
  }
});

// ✅ CLEAN SEARCH INPUT: Sanitize search query for API compatibility
function sanitizeSearchQuery(query) {
  if (!query || typeof query !== 'string') return '';
  
  // Convert to basic ASCII characters
  return query
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^\w\s-]/g, '') // Remove special characters except letters, numbers, spaces, hyphens
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim();
}

// ✅ PERFORMANCE OPTIMIZED: Local cache fallback search function with indexing
// Build and maintain a search index for O(1) lookups instead of O(n*m) iteration
let teamSearchIndex = new Map(); // teamName -> [{id, name, country, logo}]
let countrySearchIndex = new Map(); // country -> [{id, name, country, logo}]
let indexBuilt = false;

// Build search index from cached fixtures data — runs asynchronously in batches
// to avoid blocking the event loop with a single giant synchronous loop.
async function buildTeamSearchIndex() {
  if (indexBuilt) return;

  console.log('🔎 Building team search index from cache (async)...');
  teamSearchIndex.clear();
  countrySearchIndex.clear();

  const cacheKeys = myCache.keys().filter(k => k.includes('fixtures'));
  let totalMatches = 0;

  const indexTeam = (teamObj) => {
    if (!teamObj?.id || !teamObj?.name) return;
    const name    = teamObj.name.toLowerCase();
    const country = (teamObj.country || '').toLowerCase();
    const entry   = { id: teamObj.id, name: teamObj.name, country: teamObj.country || 'Unknown', logo: teamObj.logo };
    if (!teamSearchIndex.has(name))    teamSearchIndex.set(name, []);
    teamSearchIndex.get(name).push(entry);
    if (country) {
      if (!countrySearchIndex.has(country)) countrySearchIndex.set(country, []);
      countrySearchIndex.get(country).push(entry);
    }
  };

  // Process keys in small batches, yielding between each to stay non-blocking
  const BATCH_SIZE = 5;
  for (let i = 0; i < cacheKeys.length; i += BATCH_SIZE) {
    const batch = cacheKeys.slice(i, i + BATCH_SIZE);
    for (const cacheKey of batch) {
      const cachedData = myCache.get(cacheKey);
      if (!cachedData?.response || !Array.isArray(cachedData.response)) continue;
      totalMatches += cachedData.response.length;
      for (const match of cachedData.response) {
        if (!match.teams) continue;
        indexTeam(match.teams.home);
        indexTeam(match.teams.away);
      }
    }
    // Yield to the event loop between batches
    await new Promise(resolve => setImmediate(resolve));
  }

  indexBuilt = true;
  console.log(`✅ Search index built: ${teamSearchIndex.size} teams, ${countrySearchIndex.size} countries from ${totalMatches} matches`);
}


// Rebuild index when cache is cleared
const originalFlushAll = myCache.flushAll;
myCache.flushAll = function() {
  indexBuilt = false;
  teamSearchIndex.clear();
  countrySearchIndex.clear();
  return originalFlushAll.call(this);
};

// Optimized local cache search using index
async function searchInLocalCache(query) {
  const results = [];
  const seenTeams = new Set();
  const searchQuery = query.toLowerCase().trim();
  
  console.log(`🔍 Optimized local search for: "${searchQuery}"`);
  
  // Build index if not already built
  if (!indexBuilt) {
    await buildTeamSearchIndex();
  }
  
  // Try exact match first (O(1) lookup)
  if (teamSearchIndex.has(searchQuery)) {
    const teams = teamSearchIndex.get(searchQuery);
    for (const team of teams) {
      if (!seenTeams.has(team.id)) {
        results.push({ team });
        seenTeams.add(team.id);
      }
    }
    console.log(`🔍 Exact match found: ${results.length} teams`);
  }
  
  // Try country match (O(1) lookup)
  if (results.length === 0 && countrySearchIndex.has(searchQuery)) {
    const teams = countrySearchIndex.get(searchQuery);
    for (const team of teams) {
      if (!seenTeams.has(team.id)) {
        results.push({ team });
        seenTeams.add(team.id);
      }
    }
    console.log(`🔍 Country match found: ${results.length} teams`);
  }
  
  // Fallback to partial match (O(n) but only on team names, not all matches)
  if (results.length === 0) {
    for (const [teamName, teams] of teamSearchIndex.entries()) {
      if (teamName.includes(searchQuery) || searchQuery.includes(teamName)) {
        for (const team of teams) {
          if (!seenTeams.has(team.id)) {
            results.push({ team });
            seenTeams.add(team.id);
          }
        }
      }
      // Early exit if we found enough results
      if (results.length >= 10) break;
    }
    console.log(`🔍 Partial match found: ${results.length} teams`);
  }
  
  console.log(`🔍 Optimized search completed: ${results.length} teams found`);
  return results;
}

// ✅ ENHANCED: Support league selection in matches endpoint
app.get('/api/matches', async (req, res) => {
  try {
    // ✅ AUTO-REFRESH: Check if day has changed
    checkAndRefreshCache();
    
    let { date, league, teamId, from, to, id } = req.query; 
    const apiParams = {};
    
    if (id) {
        apiParams.id = id; // Direct fetch by ID (High Priority)
    } else {
        if (!date) date = getCurrentDateString();
        apiParams.date = date;
        if (league) apiParams.league = league;
        if (teamId) {
            apiParams.team = teamId;
            if (from) apiParams.from = from;
            if (to) apiParams.to = to;
        }
    }

    console.log(`📅 Fetching LIVE matches${id ? ` for ID: ${id}` : ` for date: ${date}`}${league ? ` (league: ${league})` : ''}${teamId ? ` (teamId: ${teamId})` : ''}`);
    console.log(`🔄 Live system active - Current time: ${new Date().toISOString()}`);

    // ✅ SERVER SYNC: Ensure reliable data fetching without cache interference
    const data = await fetchFromAPI('fixtures', apiParams);

    // ✅ UPSTREAM FAILURE GUARD: fetchFromAPI() returns {} (no `response` key)
    // when the api-sports.io call itself failed (bad key, rate limit, network).
    // Previously this was sent back as a 200 OK with an empty object, which the
    // frontend correctly rejected as "Invalid API response" but gave the user
    // no real explanation. Surface it as a proper error instead.
    if (!data || !Array.isArray(data.response)) {
      console.error('❌ Upstream football API returned no usable data for /api/matches');
      return res.status(502).json({
        error: "تعذر جلب بيانات المباريات من المصدر الخارجي",
        response: []
      });
    }

    // ✅ LOG LIVE DATA: Show live match status
    if (data.response && data.response.length > 0) {
      const liveMatches = data.response.filter(match => {
        const status = match.fixture?.status?.short;
        return status && status !== 'NS' && status !== 'FT' && status !== 'AET' && status !== 'PEN' && status !== 'PST';
      });
      
      if (liveMatches.length > 0) {
        console.log(`🔴 LIVE FEED: ${liveMatches.length} live matches found`);
        liveMatches.forEach(match => {
          const status = match.fixture?.status?.short;
          const elapsed = match.fixture?.status?.elapsed || 0;
          const homeTeam = match.teams?.home?.name || 'Unknown';
          const awayTeam = match.teams?.away?.name || 'Unknown';
          const homeScore = match.goals?.home || 0;
          const awayScore = match.goals?.away || 0;
          
          console.log(`🔴 ${status} ${elapsed}' - ${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`);
        });
      }
    }
      
      console.log(`📊 Total matches fetched: ${data.response?.length || 0}`);
      res.json(data);

  } catch (error) {
    console.error('❌ Error in /api/matches:', error.message);
    res.status(500).json({ error: "خطأ في جلب المباريات" });
  }
});

////////////////////////////////////////////////////
// 🗺️ Sitemap route moved BEFORE helmet() at top of middleware chain (line ~298)
// to prevent helmet from overriding the application/xml Content-Type.


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

// JSON-LD Structured Data endpoint for football events
app.get('/api/structured-data', async (req, res) => {
  try {
    const { date } = req.query;
    const today = date || new Date().toISOString().split('T')[0];
    const matchesData = await fetchFromAPI('fixtures', { date: today });
    const matches = (matchesData.response || []).slice(0, 8);

    // Filter to notable matches: live first, then by league importance
    const MAJOR_LEAGUES = [39,140,135,78,61,2,3,848]; // PL,LaLiga,SerieA,Bundesliga,Ligue1,UCL,UEL,UECL
    const sorted = [...matches].sort((a,b) => {
      const aLive = !['NS','FT','PST'].includes(a.fixture?.status?.short) ? 1 : 0;
      const bLive = !['NS','FT','PST'].includes(b.fixture?.status?.short) ? 1 : 0;
      const aMajor = MAJOR_LEAGUES.includes(a.league?.id) ? 1 : 0;
      const bMajor = MAJOR_LEAGUES.includes(b.league?.id) ? 1 : 0;
      return (bLive + bMajor) - (aLive + aMajor);
    });

    const structuredData = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "name": "MatchLogic | ماتش لوجيك",
          "url": "https://matchlogic-server.vercel.app/",
          "potentialAction": {
            "@type": "SearchAction",
            "target": "https://matchlogic-server.vercel.app/?q={search_term_string}",
            "query-input": "required name=search_term_string"
          }
        },
        ...sorted.map(match => ({
          "@type": "SportsEvent",
          "name": `${match.teams?.home?.name} vs ${match.teams?.away?.name}`,
          "sport": "Football",
          "startDate": match.fixture?.date,
          "eventStatus": match.fixture?.status?.short === 'FT'
            ? "https://schema.org/EventScheduled"
            : "https://schema.org/EventScheduled",
          "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode",
          "url": `https://matchlogic-server.vercel.app/match.html?id=${match.fixture?.id}`,
          "organizer": {
            "@type": "Organization",
            "name": match.league?.name || "Football League"
          },
          "competitor": [
            {
              "@type": "SportsTeam",
              "name": match.teams?.home?.name,
              "image": match.teams?.home?.logo
            },
            {
              "@type": "SportsTeam",
              "name": match.teams?.away?.name,
              "image": match.teams?.away?.logo
            }
          ],
          "location": {
            "@type": "Place",
            "name": match.fixture?.venue?.name || match.league?.country || "Stadium"
          }
        }))
      ]
    };

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(structuredData);
  } catch (error) {
    console.error('❌ Error generating structured data:', error.message);
    res.status(500).json({ error: "Failed to generate structured data" });
  }
});

// Test endpoint to check API key validity
app.get('/api/test-key', async (req, res) => {
  try {
    console.log(`🔑 Testing RapidAPI key`);
    
    // Test with a simple endpoint that should work
    const data = await fetchFromAPI('countries', {});
    console.log(`🔑 Countries API Response:`, data);
    res.json({ 
      apiKeyValid: true, 
      countriesCount: data.response?.length || 0,
      sampleData: data.response?.slice(0, 3) || []
    });

  } catch (error) {
    console.error('❌ API key test error:', error.message);
    res.status(500).json({ 
      apiKeyValid: false, 
      error: error.message 
    });
  }
});

// Test endpoint to fetch all matches without filters
app.get('/api/matches-test', async (req, res) => {
  try {
    console.log(`🧪 Testing RapidAPI without filters`);
    
    // Try minimal parameters
    const data = await fetchFromAPI('fixtures', {});
    console.log(`🧪 Test API Response:`, data);
    res.json(data);

  } catch (error) {
    console.error('❌ Error in /api/matches-test:', error.message);
    res.status(500).json({ error: "Test error" });
  }
});

////////////////////////////////////////////////////
// ⚽ أحداث
////////////////////////////////////////////////////
app.get('/api/match/events/:id', async (req, res) => {
  try {
    const data = await fetchFromAPI('fixtures/events', { fixture: req.params.id }, true);
    res.json(data);
  } catch (err) {
    console.error('❌ Error in events endpoint:', err.message);
    res.status(500).json({ error: "خطأ في جلب الأحداث" });
  }
});

////////////////////////////////////////////////////
// 📋 التشكيلة
////////////////////////////////////////////////////
app.get('/api/match/lineups/:id', async (req, res) => {
  try {
    const data = await fetchFromAPI('fixtures/lineups', { fixture: req.params.id }, true);
    res.json(data);
  } catch (err) {
    console.error('❌ Error in lineups endpoint:', err.message);
    res.status(500).json({ error: "خطأ في جلب التشكيلة" });
  }
});

////////////////////////////////////////////////////
// 🤖 تحليل ذكي — محلل إحصائي متكامل (بدون AI خارجي)
////////////////////////////////////////////////////

// Cache خاص بالتحليل — مباشر 2 دقيقة، قادم 15 دقيقة
const analysisCache = new NodeCache({ stdTTL: 120 });

function calcStatValue(raw) {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'string' && raw.includes('%')) return parseFloat(raw) || 0;
  return parseFloat(raw) || 0;
}

function calcLiveProbs(liveStats, homeId, awayId) {
  // أوزان كل إحصائية — مبنية على أبحاث إحصائيات كرة القدم
  const W = {
    'Ball Possession':      { w: 0.18, normalize: true },
    'Shots on Goal':        { w: 0.32, normalize: false },
    'Total Shots':          { w: 0.12, normalize: false },
    'Blocked Shots':        { w: 0.06, normalize: false },
    'Corner Kicks':         { w: 0.10, normalize: false },
    'Dangerous Attacks':    { w: 0.16, normalize: false },
    'Attacks':              { w: 0.06, normalize: false },
    'Passes accurate':      { w: 0.05, normalize: true  },
    'Yellow Cards':         { w: -0.04, normalize: false },
    'Red Cards':            { w: -0.15, normalize: false },
    'Goalkeeper Saves':     { w: -0.08, normalize: false },
  };

  let homeScore = 0, awayScore = 0;
  const homeStats = {}, awayStats = {};

  for (const teamData of liveStats) {
    const isHome = String(teamData.team?.id) === String(homeId);
    for (const s of (teamData.statistics || [])) {
      const v = calcStatValue(s.value);
      if (isHome) homeStats[s.type] = v;
      else awayStats[s.type] = v;
    }
  }

  for (const [type, cfg] of Object.entries(W)) {
    const hv = homeStats[type] || 0;
    const av = awayStats[type] || 0;
    if (cfg.normalize) {
      // نسبة مئوية: كل واحد يعطيك relative advantage
      const total = hv + av;
      if (total > 0) {
        homeScore += (hv / total - 0.5) * cfg.w * 100;
        awayScore += (av / total - 0.5) * cfg.w * 100;
      }
    } else {
      homeScore += hv * Math.abs(cfg.w) * Math.sign(cfg.w);
      awayScore += av * Math.abs(cfg.w) * Math.sign(cfg.w);
    }
  }

  // Home advantage bonus للمباريات المباشرة
  homeScore += 3;

  const diff = homeScore - awayScore;
  const absDiff = Math.abs(diff);

  // تعادل يقل مع زيادة الفارق
  const drawProb = Math.round(Math.max(8, Math.min(30, 28 - absDiff * 0.7)));
  const remaining = 100 - drawProb;

  // تحويل الـ score لنسبة
  const homeRatio = Math.max(0.2, Math.min(0.8, 0.5 + diff / (absDiff * 2 + 20)));
  const homeProb = Math.round(remaining * homeRatio);
  const awayProb = remaining - homeProb;

  return { homeProb, awayProb, drawProb, homeStats, awayStats, homeScore, awayScore };
}

function calcPreMatchProbs(homeId, awayId) {
  // قبل المباراة: home advantage + variation بالـ ID
  // ⚠️ تجنّب المعاملات الثنائية (^ و >>>) لأن IDs الفرق تتجاوز 32-bit
  // فتسبب اقتطاعاً وتقلب الإشارة. نستخدم Modulo + أعداد أولية بدلاً منها.
  const variation = ((homeId * 31 + awayId * 17) % 26) - 13; // -13 to +12, آمن لأي حجم ID
  const homeBase = 47 + variation * 0.5;
  const drawProb = Math.round(Math.max(18, Math.min(28, 24 - Math.abs(variation) * 0.3)));
  const remaining = 100 - drawProb;
  const homeProb = Math.round(Math.max(25, Math.min(65, homeBase)) * remaining / 100);
  const awayProb = remaining - homeProb;
  return { homeProb, awayProb, drawProb, homeStats: {}, awayStats: {}, homeScore: 0, awayScore: 0 };
}

// ✅ Deterministic "random" pick — same match+minute always picks the same phrasing,
// so the text doesn't flicker between refreshes, but different matches/moments vary.
function pickVariant(seedStr, variants) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  return variants[seed % variants.length];
}

function buildSmartAnalysis(match, probs, isLive, isArabic, liveStats) {
  const { homeProb, awayProb, drawProb, homeStats, awayStats, homeScore, awayScore } = probs;
  const homeName = match.teams?.home?.name || 'Home';
  const awayName = match.teams?.away?.name || 'Away';
  const minute = match.fixture?.status?.elapsed || 0;
  const homeGoals = match.goals?.home ?? 0;
  const awayGoals = match.goals?.away ?? 0;
  const fixtureId = match.fixture?.id || 0;

  const dominant = homeScore >= awayScore ? homeName : awayName;
  const domDiff = Math.abs(homeScore - awayScore);

  const homeShots = homeStats['Shots on Goal'] || 0;
  const awayShots = awayStats['Shots on Goal'] || 0;
  const homePoss = homeStats['Ball Possession'] || 0;
  const awayPoss = awayStats['Ball Possession'] || 0;
  const homeDangerous = homeStats['Dangerous Attacks'] || 0;
  const awayDangerous = awayStats['Dangerous Attacks'] || 0;
  const homeCorners = homeStats['Corner Kicks'] || 0;
  const awayCorners = awayStats['Corner Kicks'] || 0;

  // Seed varies per match AND per ~5-minute window, so phrasing rotates as the match
  // progresses but stays stable between quick refreshes of the same moment.
  const seed = `${fixtureId}-${Math.floor(minute / 5)}`;

  // ── TIME AWARENESS ──────────────────────────────────────────────
  // Dominance read differently depending on how much of the match remains.
  let timeContext = '';
  if (isLive && minute > 0) {
    if (minute >= 80) timeContext = isArabic ? 'والوقت يداهم' : 'with time running out';
    else if (minute >= 60) timeContext = isArabic ? 'في الشوط الثاني' : 'deep in the second half';
    else if (minute <= 15) timeContext = isArabic ? 'في بداية مبكرة' : 'in an early stage';
  }

  // ── SPECIAL CASE: a team is dominating statistically but losing on the scoreboard ──
  // This is the most "alive commentator" moment — worth calling out explicitly.
  const homeIsDominantButLosing = homeScore > awayScore + 5 && awayGoals > homeGoals;
  const awayIsDominantButLosing = awayScore > homeScore + 5 && homeGoals > awayGoals;

  if (isArabic) {
    if (isLive && liveStats && liveStats.length > 0) {
      // Special-case narrative takes priority — it's the most match-relevant insight
      if (homeIsDominantButLosing || awayIsDominantButLosing) {
        const dominantButLosingTeam = homeIsDominantButLosing ? homeName : awayName;
        const leadingTeam = homeIsDominantButLosing ? awayName : homeName;
        const variants = [
          `${dominantButLosingTeam} يفرض السيطرة بوضوح ويملك الفرص الأكثر، لكن ${leadingTeam} هو من يقود النتيجة فعلياً${timeContext ? ' ' + timeContext : ''}. الأرقام تقول شيئاً والنتيجة تقول شيئاً آخر.`,
          `مفارقة واضحة في هذه المباراة: ${dominantButLosingTeam} أفضل في كل الإحصائيات تقريباً، لكنه متأخر في النتيجة أمام ${leadingTeam}${timeContext ? ' ' + timeContext : ''}. لو استمر هذا الضغط فقد يأتي التعادل أو حتى الانقلاب.`,
        ];
        return pickVariant(seed, variants);
      }

      const domLevel = domDiff > 15
        ? pickVariant(seed, ['يهيمن بشكل واضح', 'يسيطر سيطرة كاملة', 'متفوق بفارق كبير'])
        : domDiff > 7
          ? pickVariant(seed, ['يتقدم في السيطرة', 'يمسك بخيوط اللعب', 'له اليد العليا'])
          : pickVariant(seed, ['يحافظ على توازن دقيق', 'في مباراة متكافئة جداً', 'في صراع متقارب']);

      let scoreContext = '';
      if (homeGoals > awayGoals) scoreContext = `${homeName} يقود بـ ${homeGoals}-${awayGoals}، `;
      else if (awayGoals > homeGoals) scoreContext = `${awayName} يتقدم بـ ${awayGoals}-${homeGoals}، `;
      else if (homeGoals > 0) scoreContext = `المباراة متعادلة ${homeGoals}-${awayGoals}، `;

      let statsLine = '';
      if (homeShots > 0 || awayShots > 0) statsLine += `التسديدات على المرمى: ${homeName} ${homeShots} مقابل ${awayShots} لـ ${awayName}. `;
      if (homePoss > 0) statsLine += `الاستحواذ ${homePoss}%–${awayPoss}%. `;
      if (homeDangerous > 0 || awayDangerous > 0) statsLine += `الهجمات الخطرة: ${homeDangerous} مقابل ${awayDangerous}. `;
      // ✅ Corner kicks now actually used — meaningful when shots are close but corners aren't
      if ((homeCorners > 0 || awayCorners > 0) && Math.abs(homeShots - awayShots) <= 2) {
        statsLine += `الركنيات ${homeCorners}–${awayCorners}، وهو مؤشر إضافي على من يضغط أكثر على المرمى. `;
      }

      let prediction = '';
      if (homeProb > awayProb + 12) prediction = pickVariant(seed + 'p', [`التوقع يميل لصالح ${homeName} للفوز`, `الأقرب أن يحسم ${homeName} اللقاء`]);
      else if (awayProb > homeProb + 12) prediction = pickVariant(seed + 'p', [`التوقع يميل لصالح ${awayName} للفوز`, `الأقرب أن يحسم ${awayName} اللقاء`]);
      else prediction = pickVariant(seed + 'p', ['المباراة مفتوحة وقد تنتهي بأي نتيجة', 'النتيجة ما زالت في كفة الاحتمالات المفتوحة']);

      return `${scoreContext}${dominant} ${domLevel}${timeContext ? ' ' + timeContext : ''} في الدقيقة ${minute || '?'}. ${statsLine}${prediction}.`;
    } else {
      // قبل المباراة
      if (homeProb > awayProb + 12) {
        return pickVariant(seed, [
          `${homeName} يدخل هذه المباراة بميزة الأرض وتفوق في التوقعات. الضغط سيكون من جانبه منذ الصافرة الأولى.`,
          `الأرقام تصب في صالح ${homeName}، الذي يدخل اللقاء كمرشح أوفر حظاً بفضل عامل الأرض.`,
        ]);
      } else if (awayProb > homeProb + 12) {
        return pickVariant(seed, [
          `${awayName} هو المرشح الأقوى رغم لعبه بعيداً عن أرضه. يمتلك الأفضلية الإجمالية في هذا اللقاء.`,
          `رغم استضافة ${homeName} للمباراة، فإن ${awayName} يدخل بأفضلية واضحة في التوقعات.`,
        ]);
      } else {
        return pickVariant(seed, [
          `مواجهة متكافئة يصعب التنبؤ بها. ${homeName} يمتلك ميزة الملعب لكن ${awayName} قادر على المنافسة بقوة.`,
          `لا يوجد مرشح واضح هنا، التوازن شبه تام بين ${homeName} و${awayName} قبل صافرة البداية.`,
        ]);
      }
    }
  } else {
    if (isLive && liveStats && liveStats.length > 0) {
      if (homeIsDominantButLosing || awayIsDominantButLosing) {
        const dominantButLosingTeam = homeIsDominantButLosing ? homeName : awayName;
        const leadingTeam = homeIsDominantButLosing ? awayName : homeName;
        const variants = [
          `${dominantButLosingTeam} are clearly the better side on the stats sheet, but it's ${leadingTeam} leading on the scoreboard${timeContext ? ' ' + timeContext : ''}. The numbers and the result are telling two different stories.`,
          `A real contrast here: ${dominantButLosingTeam} dominate the underlying numbers yet trail ${leadingTeam}${timeContext ? ' ' + timeContext : ''}. Keep this pressure up and an equalizer — or more — could be coming.`,
        ];
        return pickVariant(seed, variants);
      }

      const domLevel = domDiff > 15
        ? pickVariant(seed, ['clearly dominating', 'fully in control', 'well on top'])
        : domDiff > 7
          ? pickVariant(seed, ['edging control', 'holding the upper hand', 'shading the contest'])
          : pickVariant(seed, ['in a tight contest', 'in a closely balanced match', 'locked in a close battle']);

      let scoreContext = '';
      if (homeGoals > awayGoals) scoreContext = `${homeName} leads ${homeGoals}-${awayGoals}, `;
      else if (awayGoals > homeGoals) scoreContext = `${awayName} leads ${awayGoals}-${homeGoals}, `;
      else if (homeGoals > 0) scoreContext = `Scores level at ${homeGoals}-${awayGoals}, `;

      let statsLine = '';
      if (homeShots > 0 || awayShots > 0) statsLine += `Shots on target: ${homeName} ${homeShots}–${awayShots} ${awayName}. `;
      if (homePoss > 0) statsLine += `Possession ${homePoss}%–${awayPoss}%. `;
      if (homeDangerous > 0 || awayDangerous > 0) statsLine += `Dangerous attacks: ${homeDangerous} vs ${awayDangerous}. `;
      if ((homeCorners > 0 || awayCorners > 0) && Math.abs(homeShots - awayShots) <= 2) {
        statsLine += `Corners ${homeCorners}–${awayCorners}, another sign of who's pressing forward more. `;
      }

      let prediction = '';
      if (homeProb > awayProb + 12) prediction = pickVariant(seed + 'p', [`${homeName} are favourites to take the win`, `${homeName} look the more likely winners`]);
      else if (awayProb > homeProb + 12) prediction = pickVariant(seed + 'p', [`${awayName} are favourites to take the win`, `${awayName} look the more likely winners`]);
      else prediction = pickVariant(seed + 'p', ['This one could go either way', 'The result remains wide open']);

      return `${scoreContext}${dominant} ${domLevel}${timeContext ? ' ' + timeContext : ''} at minute ${minute || '?'}. ${statsLine}${prediction}.`;
    } else {
      if (homeProb > awayProb + 12) {
        return pickVariant(seed, [
          `${homeName} are clear favourites with home advantage on their side.`,
          `The numbers favour ${homeName}, who enter as the stronger side at home.`,
        ]);
      } else if (awayProb > homeProb + 12) {
        return pickVariant(seed, [
          `${awayName} enter as favourites despite being the away side.`,
          `Even on the road, ${awayName} carry a clear edge in the pre-match numbers.`,
        ]);
      } else {
        return pickVariant(seed, [
          `An evenly matched contest. ${homeName} have home advantage but ${awayName} are well capable of a result.`,
          `No clear favourite here — it's close to a coin flip between ${homeName} and ${awayName}.`,
        ]);
      }
    }
  }
}

function calcExpectedGoals(homeProb, awayProb, homeGoals, awayGoals, isLive) {
  // في حالة المباشر، نبني التوقع على النتيجة الحالية
  if (isLive && (homeGoals > 0 || awayGoals > 0)) {
    const hExtra = homeProb > awayProb + 15 ? 1 : 0;
    const aExtra = awayProb > homeProb + 15 ? 1 : 0;
    return { home: homeGoals + hExtra, away: awayGoals + aExtra };
  }

  // قبل المباراة (Pre-match الذكي) — يعتمد على الفارق بين النسب
  // بدلاً من القيم المطلقة اللي كانت بتطلع 1-1 دايماً
  const diff = Math.abs(homeProb - awayProb);
  let hg = 1, ag = 1;

  if (diff <= 4) {
    // فرقان متقاربان جداً → تعادل يتأرجح بين 0-0 و 1-1
    hg = (homeProb % 2 === 0) ? 1 : 0;
    ag = hg;
  } else if (homeProb > awayProb) {
    // المضيف أقوى
    hg = diff > 20 ? 3 : (diff > 10 ? 2 : 1);
    ag = diff > 20 ? 0 : (diff > 10 ? 1 : 0);
  } else {
    // الضيف أقوى
    ag = diff > 20 ? 3 : (diff > 10 ? 2 : 1);
    hg = diff > 20 ? 0 : (diff > 10 ? 1 : 0);
  }

  return { home: hg, away: ag };
}

app.get('/api/match/analysis/:id', async (req, res) => {
  try {
    const fixtureId = req.params.id;
    const isArabic = req.query.lang === 'ar' || req.headers['accept-language']?.startsWith('ar');

    // Cache check
    const cacheKey = `analysis-${fixtureId}-${isArabic ? 'ar' : 'en'}`;
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      console.log('⚡ Analysis from cache:', fixtureId);
      return res.json(cached);
    }

    // جلب بيانات المباراة
    const matchData = await fetchFromAPI('fixtures', { id: fixtureId }, true);
    const match = matchData.response?.[0];
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const status = match.fixture?.status?.short;
    const isFinished = ['FT', 'AET', 'PEN'].includes(status);
    if (isFinished) return res.json({ error: 'Match finished', finished: true });

    const isLive = status && !['NS', 'PST', 'CANC', 'ABD'].includes(status);

    // جلب الإحصائيات المباشرة
    let liveStats = [];
    if (isLive) {
      try {
        const sd = await fetchFromAPI('fixtures/statistics', { fixture: fixtureId }, false);
        liveStats = sd.response || [];
      } catch(e) { console.log('⚠️ Stats unavailable'); }
    }

    // حساب الاحتمالات
    const probs = isLive && liveStats.length > 0
      ? calcLiveProbs(liveStats, match.teams?.home?.id, match.teams?.away?.id)
      : calcPreMatchProbs(match.teams?.home?.id || 0, match.teams?.away?.id || 0);

    const { homeProb, awayProb, drawProb } = probs;

    // الفائز المتوقع
    const winnerName = homeProb > awayProb + 5
      ? match.teams?.home?.name
      : awayProb > homeProb + 5
        ? match.teams?.away?.name
        : (isArabic ? 'تعادل متوقع' : 'Draw Expected');

    const winnerId = homeProb > awayProb + 5
      ? match.teams?.home?.id
      : awayProb > homeProb + 5
        ? match.teams?.away?.id
        : null;

    // التحليل النصي الذكي
    const analysisText = buildSmartAnalysis(match, probs, isLive, isArabic, liveStats);

    // الأهداف المتوقعة
    const expectedGoals = calcExpectedGoals(
      homeProb, awayProb,
      match.goals?.home ?? 0, match.goals?.away ?? 0,
      isLive
    );

    const result = {
      response: [{
        predictions: {
          winner: { name: winnerName, id: winnerId },
          advice: analysisText,
          percent: { home: homeProb, draw: drawProb, away: awayProb },
          goals: expectedGoals,
        },
        league: { name: match.league?.name || '', country: match.league?.country || '' },
        teams: {
          home: { name: match.teams?.home?.name, id: match.teams?.home?.id, logo: match.teams?.home?.logo },
          away: { name: match.teams?.away?.name, id: match.teams?.away?.id, logo: match.teams?.away?.logo },
        },
        fixture: { id: fixtureId, date: match.fixture?.date, status: match.fixture?.status },
        meta: { isLive, statsAvailable: liveStats.length > 0 },
      }]
    };

    // Cache: 2 دقيقة مباشر، 15 دقيقة قادم
    analysisCache.set(cacheKey, result, isLive ? 120 : 900);
    res.json(result);

  } catch (error) {
    console.error('❌ Analysis error:', error.message);
    res.status(500).json({ error: 'Failed to generate analysis' });
  }
});

////////////////////////////////////////////////////
// 📊 League Standings
////////////////////////////////////////////////////
app.get('/api/standings/:leagueId/:season', async (req, res) => {
  try {
    const { leagueId, season } = req.params;
    const data = await fetchFromAPI('standings', { league: leagueId, season: season });
    res.json(data);
  } catch (error) {
    console.error('❌ Error fetching standings:', error.message);
    res.status(500).json({ error: "Failed to fetch standings" });
  }
});

////////////////////////////////////////////////////
// 🔮 AI Match Prediction
////////////////////////////////////////////////////
app.get('/api/match/prediction/:id', async (req, res) => {
  try {
    const data = await fetchFromAPI('predictions', { fixture: req.params.id });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch prediction" });
  }
});

////////////////////////////////////////////////////
// ⚔️ Head-to-Head History
////////////////////////////////////////////////////
app.get('/api/match/h2h', async (req, res) => {
  try {
    const { h2h, last } = req.query;
    const data = await fetchFromAPI('fixtures/headtohead', { h2h, last: last || 5 });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch H2H" });
  }
});

////////////////////////////////////////////////////
// 🔍 League ID lookup — utility for verifying tournament IDs
// (e.g. GET /api/leagues?search=Euro  →  confirms the exact league.id to use
// in IMPORTANT_LEAGUES on the frontend, instead of guessing from docs)
////////////////////////////////////////////////////
app.get('/api/leagues', async (req, res) => {
  try {
    const { search } = req.query;
    if (!search || search.length < 3) {
      return res.status(400).json({ error: "Provide at least 3 characters in 'search'" });
    }
    const data = await fetchFromAPI('leagues', { search });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to search leagues" });
  }
});

////////////////////////////////////////////////////
// 📈 الإحصائيات
////////////////////////////////////////////////////
app.get('/api/match/statistics/:id', async (req, res) => {
  try {
    const data = await fetchFromAPI('fixtures/statistics', { fixture: req.params.id }, true);
    res.json(data);
  } catch (err) {
    console.error('❌ Error in statistics endpoint:', err.message);
    res.status(500).json({ error: "خطأ في جلب الإحصائيات" });
  }
});

////////////////////////////////////////////////////
// 🔍 بحث الفرق (للمفضلة)
////////////////////////////////////////////////////
app.get('/api/teams/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 3) {
      return res.json({ response: [] });
    }
    
    // Arabic to English team name mapping
    const ARABIC_TEAM_MAPPING = {
      // Premier League
      'أرسنال': 'Arsenal',
      'مانشستر سيتي': 'Manchester City',
      'مانشستر يونايتد': 'Manchester United',
      'ليفربول': 'Liverpool',
      'تشيلسي': 'Chelsea',
      'توتنهام': 'Tottenham',
      'برايتون': 'Brighton',
      'كريستال بالاس': 'Crystal Palace',
      'فولهام': 'Fulham',
      'برينتفورد': 'Brentford',
      'إيفرتون': 'Everton',
      'ليدز يونايتد': 'Leeds United',
      'وست هام يونايتد': 'West Ham United',
      'أستون فيلا': 'Aston Villa',
      'نيوكاسل يونايتد': 'Newcastle United',
      'ولفرهامبتون': 'Wolverhampton',
      'نوتنغهام فورست': 'Nottingham Forest',
      'ساوثهامبتون': 'Southampton',
      'ليستر سيتي': 'Leicester City',
      'بورنموث': 'Bournemouth',
      
      // La Liga
      'ريال مدريد': 'Real Madrid',
      'برشلونة': 'Barcelona',
      'أتلتيكو مدريد': 'Atletico Madrid',
      'إشبيلية': 'Sevilla',
      'ريال سوسيداد': 'Real Sociedad',
      'فياريال': 'Villarreal',
      'ريال بيتيس': 'Real Betis',
      'أتلتيك بلباو': 'Athletic Bilbao',
      'فالنسيا': 'Valencia',
      'سيلتا فيغو': 'Celta Vigo',
      
      // Serie A
      'يوفنتوس': 'Juventus',
      'إنتر ميلان': 'Inter',
      'ميلان': 'Milan',
      'نابولي': 'Napoli',
      'روما': 'Roma',
      'لاسيو': 'Lazio',
      'فيورنتينا': 'Fiorentina',
      'أتالانتا': 'Atalanta',
      
      // Bundesliga
      'بايرن ميونخ': 'Bayern Munich',
      'بوروسيا دورتموند': 'Borussia Dortmund',
      'لايبزيغ': 'RB Leipzig',
      'باير ليفركوزن': 'Bayer Leverkusen',
      'أينتراخت فرانكفورت': 'Eintracht Frankfurt',
      
      // Ligue 1
      'باريس سان جيرمان': 'Paris Saint Germain',
      'أولمبيك مارسيليا': 'Marseille',
      'أولمبيك ليون': 'Lyon',
      'موناكو': 'Monaco',
      'ليل': 'Lille',
      
      // Egyptian League
      'الأهلي': 'Al Ahly',
      'الاهلي': 'Al Ahly',
      'أهلي': 'Al Ahly',
      'إهلي': 'Al Ahly',
      'آهلي': 'Al Ahly',
      'الزمالك': 'Zamalek',
      'زمالك': 'Zamalek',
      'بيراميدز': 'Pyramids',
      'إنبي': 'ENPPI',
      'سموحة': 'Smouha',
      'طلائع الجيش': 'Al Talaei El Gaish',
      'المقاولون العرب': 'Al Mokawloon Al Arab',
      'سيراميكا كليوباترا': 'Ceramica Cleopatra',
      'الاتحاد السكندري': 'Al Ittihad Alexandria',
      'غزل المحلة': 'Ghazl El Mahalla',
      
      // Saudi League
      'الهلال': 'Al Hilal',
      'النصر': 'Al Nassr',
      'الاتحاد': 'Al Ittihad',
      'الأهلي السعودي': 'Al Ahli Saudi',
      'الشباب': 'Al Shabab',
      'التعاون': 'Al Taawoun',
      'الفيحاء': 'Al Fayha',
      'الرائد': 'Al Raed',
      'الفتح': 'Al Fateh',
      'الوحده': 'Al Wehda',
      'الطائي': 'Al Taee',
      'الجبلين': 'Al Jabalain',
      'الخليج': 'Al Khaleej',
      'حطين': 'Hattin',
      'الرجاء': 'Al-Rajaa',
      'الدرعيه': 'Al-Duhail'
    };
    
    // Check if query is Arabic and map to English
    let searchQuery = q;
    if (ARABIC_TEAM_MAPPING[q]) {
      searchQuery = ARABIC_TEAM_MAPPING[q];
    } else if (isArabic(q)) {
      // FALLBACK: Translate Arabic to English for partial searches
      searchQuery = await translateArabicToEnglish(q);
      console.log(`🌐 Arabic fallback translation: "${q}" -> "${searchQuery}"`);
    }
    
    const data = await fetchFromAPI('teams', { search: searchQuery });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "خطأ في البحث عن الفرق" });
  }
});

////////////////////////////////////////////////////
// 📅 جدول الفريق (Team Schedule)
////////////////////////////////////////////////////
app.get('/api/team-schedule', async (req, res) => {
  try {
    const { team, from, to, date } = req.query;
    
    if (!team) {
      return res.status(400).json({ error: "Team ID is required" });
    }
    
    console.log(`📅 Team schedule request for team ${team}, params:`, { from, to, date });
    
    let data = { response: [] };
    
    // Use most stable approach: Season 2025
    try {
      console.log(`🔍 Using season 2025 for team ${team}`);
      const season2025Params = { team, season: 2025 };
      const fullUrl2025 = `${BASE_URL}/fixtures?${new URLSearchParams(season2025Params).toString()}`;
      console.log(`🌐 Full URL: ${fullUrl2025}`);
      data = await fetchFromAPI('fixtures', season2025Params);
      console.log(`📊 Season 2025 result: ${data.response?.length || 0} matches`);
      
    } catch (apiError) {
      console.error(`❌ API Error in team schedule:`, apiError.message);
      if (apiError.response) {
        console.error(`❌ API Response Status:`, apiError.response.status);
        console.error(`❌ API Response Data:`, apiError.response.data);
      }
    }
    
    console.log(`🎯 Final result: ${data.response?.length || 0} matches for team ${team}`);
    
    // Log sample match data if found
    if (data.response && data.response.length > 0) {
      console.log(`📋 Sample match:`, {
        date: data.response[0].fixture?.date,
        teams: `${data.response[0].teams?.home?.name} vs ${data.response[0].teams?.away?.name}`,
        league: data.response[0].league?.name,
        season: data.response[0].league?.season
      });
    }
    
    res.json(data);
    
  } catch (error) {
    console.error('❌ Error in /api/team-schedule:', error.message);
    res.status(500).json({ error: "خطأ في جلب جدول الفريق" });
  }
});


// Cache purge on startup
function forceCachePurge() {
  const isCriticalUpdate = process.env.FORCE_CACHE_PURGE === 'true' ||
                           process.env.NODE_ENV === 'development' ||
                           process.env.CRITICAL_UPDATE === 'true';
  if (!isCriticalUpdate) {
    console.log('🛡️ SKIP CACHE PURGE - preserving API quota');
    return;
  }
  console.log('🧹 Forcing cache purge...');
  const mainCacheKeys = myCache.keys();
  mainCacheKeys.forEach(key => myCache.del(key));
  console.log(`🗑️ Cleared ${mainCacheKeys.length} keys from main cache`);
  const teamCacheKeys = teamCache.keys();
  teamCacheKeys.forEach(key => teamCache.del(key));
  pendingRequests.clear();
  console.log('✅ Cache purge completed');
}

// ALWAYS listen for connections, even in production mode for local testing
forceCachePurge();


app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is LIVE and listening!`);
  console.log(`🔗 Local Access: http://localhost:${PORT}`);
  console.log(`🌐 Network Access: http://127.0.0.1:${PORT}`);
  console.log(`🔥 Cache purged - Fresh start ready!`);
});

// Export for Vercel deployment (serverless)
module.exports = app;
