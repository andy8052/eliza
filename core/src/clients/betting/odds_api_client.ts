import axios from 'axios';

const API_KEY = process.env.ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com/v4/sports';

interface OddsResponse {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: {
        key: string;
        title: string;
        markets: {
            key: string;
            outcomes: {
                name: string;
                price: number;
                point?: number;
            }[];
        }[];
    }[];
}

export async function getOdds() {
    const sports = ['basketball_nba', 'basketball_ncaab', 'americanfootball_nfl', 'icehockey_nhl', 'baseball_mlb'];
    const allOdds: OddsResponse[] = [];
    
    for (const sport of sports) {
        try {
            console.log(`Fetching odds for ${sport}...`);
            const response = await axios.get(`${BASE_URL}/${sport}/odds`, {
                params: {
                    apiKey: API_KEY,
                    regions: 'us',
                    markets: 'h2h,spreads,totals',
                    oddsFormat: 'american'
                }
            });
            
            allOdds.push(...response.data);
            console.log(`Successfully fetched ${response.data.length} events for ${sport}`);
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`Error fetching ${sport}:`, error.message);
            continue;
        }
    }
    
    console.log(`Successfully fetched ${allOdds.length} total events`);
    return allOdds;
} 