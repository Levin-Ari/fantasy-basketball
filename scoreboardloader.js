//Load data and populate tables
async function fetchAndProcessData() {
    try {
        const[teamsResponse, apiResponse] = await Promise.all([
            fetch('entries.json'),
            fetch('https://engage-api.boostsport.ai/api/sport/wbb/stats/table?split=all&level=season&teams=all&category=player&section=totals&conference=Big%20Ten&seasons=2025&view=table&type=player&limit=1000&orderBy=default_rank&order=asc')
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

        // Populate tables
        populateTopTeams(teamsData.slice(0, 5));
        populateTopPlayers(playersData.slice(0, 5));
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

loadData();