let teamsData = [];
let playersData = [];
let yesterdayPlayersData = [];
let positionCategories = {};

//Load data and populate tables
async function fetchAndProcessData() {
    try {
        const[teamsResponse, apiResponse] = await Promise.all([
            fetch('entries.json'),
            fetch('https://engage-api.boostsport.ai/api/sport/wbb/stats/table?split=all&level=season&teams=all&category=player&section=totals&conference=Big%20Ten&seasons=2025&view=table&type=player&limit=5000&orderBy=default_rank&order=asc&qualifier=default_qualifier')
        ]);

        const teamsData = await teamsResponse.json();

        const apiData = await apiResponse.json();

        const players = apiData.data.map(player => {
            const stats = player.data;

            const minutes = stats.find(s => s.minutes)?.minutes || 0;
            const games = stats.find(s => s.gp)?.gp || 0;
            const points = Number(stats.find(s => s.pts)?.pts) || 0;
            const rebounds = Number(stats.find(s => s.reb)?.reb) || 0;
            const assists = Number(stats.find(s => s.ast)?.ast) || 0;
            const blocks = Number(stats.find(s => s.blk)?.blk) || 0;
            const steals = Number(stats.find(s => s.stl)?.stl) || 0;
            const threes = Number(stats.find(s => s.fg3m)?.fg3m) || 0;

            const fantasy_points = points + threes + rebounds + assists + 2*steals + 2*blocks;
            const points_per_game = games > 0 ? (fantasy_points/games).toFixed(1) : 0;

            return {
                name: player.full_name,
                team: player.team_market,
                minutes: parseInt(minutes),
                games: parseInt(games),
                points: parseInt(points),
                rebounds: parseInt(rebounds),
                assists: parseInt(assists),
                blocks: parseInt(blocks),
                steals: parseInt(steals),
                threes: parseInt(threes),
                fantasy_points: fantasy_points,
                points_per_game: parseFloat(points_per_game)
            };
        });

        const uniquePlayers = Array.from(
            new Map(players.map(p => [p.name, p])).values()
        );
        uniquePlayers.sort((a, b) => b.fantasy_points - a.fantasy_points);

        uniquePlayers.forEach((player, i) => {
            player.rank = i + 1;
        });

        const getPoints = (playerName) => {
            const player = uniquePlayers.find(p => p.name === playerName);
            return player ? player.fantasy_points : 0;
        };

        teamsData.forEach(team => {
            team.p1_points = getPoints(team.p1);
            team.p2_points = getPoints(team.p2);
            team.p3_points = getPoints(team.p3);
            team.p4_points = getPoints(team.p4);
            team.p5_points = getPoints(team.p5);
            team.p6_points = getPoints(team.p6);
            team.p7_points = getPoints(team.p7);
            team.p8_points = getPoints(team.p8);
            team.p9_points = getPoints(team.p9);
            team.p10_points = getPoints(team.p10);

            team.total_score = 
                team.p1_points + team.p2_points + team.p3_points + team.p4_points + team.p5_points + team.p6_points + team.p7_points + team.p8_points + team.p9_points + team.p10_points;
        })

        teamsData.sort((a, b) => b.total_score - a.total_score);
        
        teamsData.forEach((team, i) => {
            team.rank = i + 1;
        });

        return {teams: teamsData, players: uniquePlayers}


    } catch(error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

async function loadData(){
    try {
        const data = await fetchAndProcessData();
        teamsData = data.teams;
        playersData = data.players;

        await loadYesterdayData();
        await loadCategories();

        // Populate tables
        populateTopTeams(teamsData.slice(0, 5));
        populateTopPlayers(playersData.slice(0, 10));
        populateTopByCategory();
        populateFullTeams(teamsData);
        populateFullPlayers(playersData);

        setupTableSorting('teams-table', teamsData, populateFullTeams);
        setupTableSorting('players-table', playersData, populateFullPlayers);

        //Hide loading, show content
        document.getElementById('loading').style.display = 'none'
        document.getElementById('content').style.display = 'block';
    
    } catch(error) {
        console.error('Error loading data:', error)
        document.getElementById('loading').style.display = 'none';
        const errorDiv = document.getElementById('error')
        errorDiv.textContent = `Error loading data: ${error.message}. Contact Ari with a bug report.`
    }
}

async function loadYesterdayData() {
    try {
        const yesterday = new Date(
            new Date().toLocaleString("en-US", {timeZone : 'America/New_York'})
        );
        yesterday.setDate(yesterday.getDate() - 1);
        const year = yesterday.getFullYear();
        const month = String(yesterday.getMonth() + 1).padStart(2, '0');
        const day = String(yesterday.getDate()).padStart(2, '0');
        const filename = `daily-outputs/${year}-${month}-${day}_daily.json`

        const response = await fetch(filename)

        if (!response.ok) {
            throw new Error(`Yesterday's data not found`)
        }

        yesterdayPlayersData = await response.json()
        populateYesterdayPlayers(yesterdayPlayersData.slice(0, 5));

        const dateStr = yesterday.toLocaleDateString("en-US", {
            timezone: 'America/New_York',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
        document.getElementById('yesterday-date').textContent = dateStr;

    } catch (error) {
        console.error('Error loading yesterday data:', error);
        document.getElementById('yesterday-players-body').innerHTML = `
        <tr>
            <td colspan="4" style="text-align: center; padding: 20px; color: #999;">
                No data available for yesterday
            </td>
        </tr>
    `;
    document.getElementById('yesterday-date').textContent = 'Data not available';
    }
}

async function loadCategories() {
    try {
        const response = await fetch('categories.json')

        if (!response.ok) {
            throw new Error('Positions file not found');
        }

        positionCategories = await response.json();
    } catch (error) {
        console.error('Error loading player categories:', error);
        document.getElementById('top-by-category-body').innerHTML = `
        <tr>
            <td colspan="4" style="text-align: center; padding: 20px; color: #999;">
                Category data not available
            </td>
        </tr>
        `;
    }
}

function setupTableSorting(tableId, data, populateFunction) {
    const table = document.getElementById(tableId);
    const headers = table.querySelectorAll('th.sortable');
    let currentSort = {column: null, direction: 'desc'};

    headers.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.column;
            const type = header.dataset.type;

            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.direction = type === 'number' ? 'desc' : 'asc';
            }
            currentSort.column = column;

            headers.forEach(h => {
                h.classList.remove('sort-asc', 'sort-desc');
            });

            header.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');

            const sortedData = [...data].sort((a, b) => {
                let aVal = a[column];
                let bVal = b[column];

                if (aVal == null) return 1;
                if (bVal === null) return -1;

                if (type === 'number') {
                    aVal = parseFloat(aVal);
                    bVal = parseFloat(bVal);
                } else {
                    aVal = String(aVal).toLowerCase();
                    bVal = String(bVal).toLowerCase();
                }

                if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            });

            populateFunction(sortedData);
        });
    });
}

function populateTopTeams(teams) {
    const tbody = document.getElementById('top-teams-body');
    tbody.innerHTML = teams.map((team, index) =>`
    <tr>
        <td class="rank">${index + 1}</td>
        <td>${team.team}</td>
        <td class="points">${team.total_score}</td>
    `).join('');
}

function populateTopPlayers(players) {
    const tbody = document.getElementById('top-players-body');
    tbody.innerHTML = players.map((player, index) => `
    <tr>
        <td class="rank">${index + 1}</td>
        <td>${player.name}</td>
        <td>${player.team}</td>
        <td class="points">${player.fantasy_points}</td>
    </tr>
    `).join('');
}

function populateFullTeams(teams) {
    const tbody = document.getElementById('full-teams-body');
    tbody.innerHTML = teams.map((team, index) => `
        <tr>
            <td class="rank">${team.rank}</td>
            <td>${team.team}</td>
            <td>${team.p1} (${team.p1_points})</td>
            <td>${team.p2} (${team.p2_points})</td>
            <td>${team.p3} (${team.p3_points})</td>
            <td>${team.p4} (${team.p4_points})</td>
            <td>${team.p5} (${team.p5_points})</td>
            <td>${team.p6} (${team.p6_points})</td>
            <td>${team.p7} (${team.p7_points})</td>
            <td>${team.p8} (${team.p8_points})</td>
            <td>${team.p9} (${team.p9_points})</td>
            <td>${team.p10} (${team.p10_points})</td>
            <td class="points">${team.total_score}</td>
        </tr>
    `).join('');
}

function populateFullPlayers(players) {
    const tbody = document.getElementById('full-players-body');
    tbody.innerHTML = players.map((player, index) => `
        <tr>
            <td class="rank">${index + 1}</td>
            <td>${player.name}</td>
            <td>${player.team}</td>
            <td>${player.games}</td>
            <td>${player.minutes}</td>
            <td>${player.points}</td>
            <td>${player.rebounds}</td>
            <td>${player.assists}</td>
            <td>${player.blocks}</td>
            <td>${player.steals}</td>
            <td>${player.threes}</td>
            <td class="points">${player.fantasy_points}</td>
            <td>${player.points_per_game.toFixed(1)}</td>
        </tr>
    `).join('');
}

function populateYesterdayPlayers(players) {
    const tbody = document.getElementById('yesterday-players-body');
    tbody.innerHTML = players.map((player, index) => `
        <tr>
            <td class="rank">${index + 1}</td>
            <td>${player.name}</td>
            <td>${player.team}</td>
            <td class="points">${player.daily_points}</td>
        <tr>
    `).join('');
}

function populateTopByCategory() {
    const tbody = document.getElementById('top-by-category-body');

    const positionOrder = [
        {key: 'p1', label: 'Betts'},
        {key: 'p2', label: 'Returning Scorer'},
        {key: 'p3', label: 'All-Conference'},
        {key: 'p4', label: 'Newcomer'},
        {key: 'p5', label: 'Shooter'},
        {key: 'p6', label: 'Post Presence'},
        {key: 'p7', label: 'Breakout Guard'},
        {key: 'p8', label: 'Breakout Forward'},
        {key: 'p9', label: 'Freshman'},
        {key: 'p10', label: 'Wildcard'}
    ];

    let html = '';
    let totalPoints = 0;

    positionOrder.forEach(category => {
        const playerNames = positionCategories[category.key];

        if (!playerNames || playerNames.length === 0) {
            html += `
            <tr>
                <td style="font-weight: 600;">${category.label}</td>
                <td colspan="3" style="color: #999;">No data</td>
            </tr>
            `;
            return;
        }

        let topPlayer = null;
        let topPoints = -1;

        playerNames.forEach(name => {
            const player = playersData.find(p => p.name === name);
            if (player && player.fantasy_points > topPoints) {
                topPlayer = player;
                topPoints = player.fantasy_points;
            }
        });

        if (topPlayer) {
            totalPoints += topPlayer.fantasy_points;
            html += `
            <tr>
                <td style="font-weight: 600;">${category.label}</td>
                <td>${topPlayer.name}</td>
                <td>${topPlayer.team}</td>
                <td class="points">${topPlayer.fantasy_points}</td>
            `
        } else {
            html += `
                <tr>
                    <td style="font-weight: 600;">${category.label}</td>
                    <td colspan="3" style="color: #999;">Player not found</td>
                </tr>
            `;
        };
    });
    html += `
        <tr style="font-weight: bold; background-color: #f8f8f8;">
            <td colspan="3" style="text-align: left;">Total Fantasy Points:</td>
            <td class="points">${totalPoints}</td>
        </tr>
    `
    
    tbody.innerHTML = html;
}

loadData();