import axios from 'axios';

interface TeamData {
    strTeam: string;
    strLeague: string;
    strStadium: string;
    strForm?: string;  // Last 5 games form
    intFormedYear: string;
    strDescriptionEN: string;
}

const LEAGUE_MAPPINGS = {
    'basketball_nba': 'NBA',
    'basketball_ncaab': 'NCAA Basketball',
    'americanfootball_nfl': 'NFL',
    'icehockey_nhl': 'NHL',
    'baseball_mlb': 'MLB'
};

export async function getTeamStats(teamName: string, sport: string): Promise<TeamData | null> {
    try {
        const response = await axios.get(
            `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(teamName)}`
        );

        if (!response.data.teams) {
            console.log(`No data found for team: ${teamName}`);
            return null;
        }

        // Filter for correct league/sport
        const teamData = response.data.teams.find(
            (team: TeamData) => team.strLeague === LEAGUE_MAPPINGS[sport]
        );

        if (!teamData) {
            console.log(`No matching ${LEAGUE_MAPPINGS[sport]} data for team: ${teamName}`);
            return null;
        }

        // Get last 5 games form
        const formResponse = await axios.get(
            `https://www.thesportsdb.com/api/v1/json/3/lookupteam.php?id=${teamData.idTeam}`
        );

        if (formResponse.data.teams?.[0]?.strForm) {
            teamData.strForm = formResponse.data.teams[0].strForm;
        }

        return teamData;
    } catch (error) {
        console.error(`Error fetching data for ${teamName}:`, error.message);
        return null;
    }
} 