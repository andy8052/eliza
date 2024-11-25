import { SearchMode } from "agent-twitter-client";
import fs from "fs";
import { composeContext } from "../../core/context.ts";
import {
    generateMessageResponse,
    generateText,
} from "../../core/generation.ts";
import { log_to_file } from "../../core/logger.ts";
import { messageCompletionFooter } from "../../core/parsing.ts";
import {
    Content,
    HandlerCallback,
    IAgentRuntime,
    ModelClass,
    State,
} from "../../core/types.ts";
import { stringToUuid } from "../../core/uuid.ts";
import { ClientBase } from "./base.ts";
import { sendTweetChunks, wait } from "./utils.ts";
import { getOdds } from '../betting/odds_api_client.ts';
import { getTeamStats } from '../betting/sports_data_client.ts';

const pickAnalysisTemplate = `
You are a sports betting analyst. Review the following VERIFIED betting lines and team statistics to select the 3 most promising bets.

Available Games, Lines and Stats:
{{lines}}

For each pick:
1. ALWAYS include the exact spread (-3.5, +7.5) or total (O/U 220.5) in your pick when applicable
2. Use the EXACT betting line provided (example formats: "Celtics -3.5 (-110)" or "Over 220.5 (-115)")
3. Never make a pick with a line more likely than -200
4. Include specific start time (ET)

Example picks:
"PICK: Warriors @ Lakers 10:30PM ET | Lakers -3.5 (-110)
"PICK: Nets @ Bulls 8:00PM ET | Over 235.5 (-110)

Keep each pick's total response under 260 characters.

Respond with exactly 3 picks in this format:
PICK 1: [Teams - Time ET] [Exact Bet with Spread/Total & Line]
[One short sentence with statistical backing]
` + messageCompletionFooter;

export class TwitterSportsPicksClient extends ClientBase {
    private lastSearchTime: number = 0;
    private searchTerms = [
        "sports betting picks",
        "betting predictions",
        "sports picks today",
        "betting tips today",
        "#GamblingTwitter",
    ];

    onReady() {
        const scheduleNextRun = () => {
            const now = new Date();
            const targetTime = new Date(now);
            targetTime.setHours(11, 45, 0, 0); // Run at 11:45 AM ET

            // If it's already past 11:45 AM, schedule for next day
            if (now > targetTime) {
                targetTime.setDate(targetTime.getDate() + 1);
            }

            const msUntilTarget = targetTime.getTime() - now.getTime();
            
            console.log(`Next picks scheduled for: ${targetTime.toLocaleString()} ET (in ${Math.round(msUntilTarget/1000/60)} minutes)`);
            
            setTimeout(() => {
                this.searchAndAnalyzePicks();
                scheduleNextRun(); // Schedule next day's run
            }, msUntilTarget);
        };

        // Start the scheduling
        scheduleNextRun();
        
        // Also run immediately if we're just starting up
        // this.searchAndAnalyzePicks();
    }

    constructor(runtime: IAgentRuntime) {
        super({
            runtime,
        });
    }

    async searchAndAnalyzePicks() {
        try {
            console.log("Fetching odds...");
            const events = await getOdds();
            
            // Fetch team stats for each event
            const eventsWithStats = await Promise.all(
                events.map(async (event) => {
                    const homeStats = await getTeamStats(event.home_team, event.sport_key);
                    const awayStats = await getTeamStats(event.away_team, event.sport_key);
                    return {
                        ...event,
                        homeStats,
                        awayStats
                    };
                })
            );

            // Format lines and stats for analysis
            const formattedLines = eventsWithStats
                .map(event => {
                    const bookmaker = event.bookmakers[0];
                    if (!bookmaker) return null;

                    const marketsByType = {};
                    bookmaker.markets.forEach(market => {
                        marketsByType[market.key] = market.outcomes.map(outcome => {
                            const pointStr = outcome.point ? ` ${outcome.point}` : '';
                            return `${outcome.name}${pointStr} (${outcome.price})`;
                        }).join(', ');
                    });

                    return `Game: ${event.away_team} @ ${event.home_team}
                    Sport: ${event.sport_title}
                    Start: ${new Date(event.commence_time).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
                    Moneyline: ${marketsByType['h2h'] || 'N/A'}
                    Spread: ${marketsByType['spreads'] || 'N/A'}
                    Total: ${marketsByType['totals'] || 'N/A'}
                    Team Stats:
                    ${event.home_team} Form: ${event.homeStats?.strForm || 'N/A'}
                    ${event.away_team} Form: ${event.awayStats?.strForm || 'N/A'}
                    ---`;
                })
                .filter(Boolean)
                .join('\n');

            console.log("Sample of formatted lines:");
            console.log(formattedLines.substring(0, 500) + "...");

            if (!formattedLines) {
                console.log("No valid lines found to analyze");
                return;
            }

            // Generate analysis
            console.log("Generating analysis...");
            const analysis = await generateText({
                runtime: this.runtime,
                context: pickAnalysisTemplate.replace("{{lines}}", formattedLines),
                modelClass: ModelClass.SMALL,
            });

            console.log("Raw analysis response:", analysis);

            // Parse the analysis response
            let analysisText = analysis;
            
            // If the response is JSON, extract the text content
            if (analysis.trim().startsWith('```json')) {
                try {
                    const jsonStr = analysis.replace(/```json\n|\n```/g, '');
                    const parsed = JSON.parse(jsonStr);
                    analysisText = parsed.text;
                } catch (error) {
                    console.error('Error parsing JSON response:', error);
                    return;
                }
            }

            // Split into picks
            const picks = analysisText
                .split(/PICK [123]:/)
                .filter(pick => pick.trim().length > 0)
                .map(pick => pick.trim());

            console.log("Number of picks found:", picks.length);
            console.log("Raw picks:", picks);

            // Ensure we have exactly 3 picks
            if (picks.length !== 3) {
                console.log("Warning: Did not get exactly 3 picks. Got:", picks.length);
            }

            // Tweet out each pick
            for (let i = 0; i < picks.length; i++) {
                const pick = picks[i];
                const content: Content = {
                    text: `Keep Gambling Bet Of The Day\n\nPICK ${i + 1}: ${pick}`,
                    inReplyTo: undefined
                };

                try {
                    console.log(`Attempting to send tweet ${i + 1} (${content.text.length} chars):`);
                    console.log(content.text);
                    await sendTweetChunks(
                        this,
                        content,
                        stringToUuid("sports-picks-room"),
                        this.runtime.getSetting("TWITTER_USERNAME"),
                        undefined
                    );
                    console.log(`Tweet ${i + 1} sent successfully`);
                    await wait(30000); // Wait 30 seconds between tweets
                } catch (error) {
                    console.error(`Error sending pick tweet ${i + 1}:`, error);
                    console.error("Tweet content was:", content);
                }
            }

        } catch (error) {
            console.error("Error in searchAndAnalyzePicks:", error);
        }
    }
} 