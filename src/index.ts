import axios from 'axios';
// removed canvas generation per request
import fs from 'fs/promises';
import path from 'path';
import FormData from 'form-data';
import { fileURLToPath } from 'url';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

// Environment variables (set in GitHub Secrets)
const FB_PAGE_ID = process.env.FB_PAGE_ID!;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN!;
const ISS_API_URL = 'https://api.wheretheiss.at/v1/satellites/25544';

interface ISSData {
    latitude: number;
    longitude: number;
    altitude: number;
    velocity: number;
    visibility: string;
}

async function fetchISSData(): Promise<ISSData> {
    try {
        // Allow opt-in insecure TLS for environments with self-signed proxies/certs.
        // Set IGNORE_TLS=1 to bypass certificate validation (not recommended for production).
        const ignoreTls = process.env.IGNORE_TLS === '1' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
        const httpsAgent = new https.Agent({ rejectUnauthorized: !ignoreTls });
        const response = await axios.get(ISS_API_URL, { timeout: 5000, httpsAgent });
        return response.data;
    } catch (error) {
        throw new Error(`Failed to fetch ISS data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// Instead of creating an image locally, download the NASA WMS map image and return its path.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate dynamic MAP_URL with yesterday's date (always uses yesterday for reliable data availability)
function getMapUrl(): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1); // Go back one day
    const date = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format (always yesterday)
    return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&CRS=EPSG:4326&STYLES=&FORMAT=image/jpeg&TIME=${date}&BBOX=-180,-90,180,90&WIDTH=4096&HEIGHT=2048`;
}

const MAP_URL = getMapUrl();

function getHttpsAgent() {
    const ignoreTls = process.env.IGNORE_TLS === '1' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
    return new https.Agent({ rejectUnauthorized: !ignoreTls });
}

async function fetchMapImage(url: string): Promise<string> {
    const imagePath = path.join(__dirname, 'nasa-map.jpg');
    const httpsAgent = getHttpsAgent();
    const resp = await axios.get(url, { responseType: 'arraybuffer', httpsAgent, timeout: 20000 });
    const buffer = Buffer.from(resp.data);
    await fs.writeFile(imagePath, buffer);
    return imagePath;
}

function createPostMessage(data: ISSData): string {
    const now = new Date();
    const utc = now.toISOString().replace('T', ' ').replace('Z', ' UTC');

    // Extract TIME from the MAP_URL for the picture note
    let mapTime = 'unknown';
    try {
        const u = new URL(MAP_URL);
        mapTime = u.searchParams.get('TIME') ?? 'unknown';
    } catch {
        mapTime = 'unknown';
    }

    const coords = `${data.latitude.toFixed(2)}°N, ${data.longitude.toFixed(2)}°E`;
    const alt = `${data.altitude.toFixed(0)} km`;
    const speed = `${data.velocity.toFixed(0)} km/h`;
    const light = data.visibility === 'daylight' ? 'bathed in sunlight ☀️' : "passing through Earth's shadow 🌑";

    const baseInfo = `I'm over ${coords} at ~${alt}, moving ${speed}. Currently ${light}.`;
    const imageNote = `View: NASA GIBS MODIS Terra True Color (TIME=${mapTime})`;

    // Distinct first-person messages per weekday
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());
    const messages: Record<string, string> = {
        Sunday: `Hi from the ISS — ${utc}. ${baseInfo} Taking a breather and enjoying the view. ${imageNote} (ISS = International Space Station) #ISS #Space #NASA`,
        Monday: `Hi from the ISS — ${utc}. ${baseInfo} Kicked off the week with a research run. Here's the scene below. ${imageNote} (ISS = International Space Station) #ISS #Space #NASA`,
        Tuesday: `Hi from the ISS — ${utc}. ${baseInfo} Running experiments and watching the sunrise sweep across continents. ${imageNote} (ISS = International Space Station) #ISS #Space #NASA`,
        Wednesday: `Hi from the ISS — ${utc}. ${baseInfo} Midweek check-in from orbit — science, maintenance, and sweeping views. ${imageNote} (ISS = International Space Station) #ISS #Space #NASA`,
        Thursday: `Hi from the ISS — ${utc}. ${baseInfo} Preparing gear and sharing this snapshot from above. ${imageNote} (ISS = International Space Station) #ISS #Space #NASA`,
        Friday: `Hi from the ISS — ${utc}. ${baseInfo} Wrapping up a busy week onboard — enjoy this view. ${imageNote} (ISS = International Space Station) #ISS #Space #NASA`,
        Saturday: `Hi from the ISS — ${utc}. ${baseInfo} Weekend vibes above Earth — peaceful and busy all at once. ${imageNote} (ISS = International Space Station) #ISS #Space #NASA`
    };

    return messages[weekday] ?? `Hi from the ISS — ${utc}. ${baseInfo} ${imageNote} (ISS = International Space Station) #ISS #Space #NASA`;
}

async function postToFacebook(imagePath: string, message: string) {
    try {
        const url = `https://graph.facebook.com/v24.0/${FB_PAGE_ID}/photos`;
        const formData = new FormData();
        formData.append('access_token', FB_ACCESS_TOKEN);
        formData.append('message', message);
        // Append image buffer with filename so Facebook accepts it
        const imageBuffer = await fs.readFile(imagePath);
        formData.append('source', imageBuffer as unknown as any, { filename: path.basename(imagePath) } as any);

        await axios.post(url, formData, {
            headers: formData.getHeaders(),
        });
        console.log('Posted to Facebook successfully!');
    } catch (error) {
        throw new Error(`Facebook post failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function main() {
    try {
        console.log('Fetching ISS data...');
        const issData = await fetchISSData();
        console.log('Downloading map image...');
        const imagePath = await fetchMapImage(MAP_URL);
        console.log('Creating post message...');
        const message = createPostMessage(issData);
        console.log('Posting to Facebook...');
        console.log(message);
        await postToFacebook(imagePath, message);
    } catch (error) {
        console.error('Error in main:', error);
        process.exit(1); // Exit with error for GitHub Actions
    }
}

main();