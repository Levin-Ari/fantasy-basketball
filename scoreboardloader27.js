let teamsData = [];
let playersData = [];
let yesterdayPlayersData = [];
let positionCategories = {};
let seasonLoadId = 0;
let tableSortingInitialized = false;
const tableSortStates = new Map();

function getDailyOutputDates() {
    const nowParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());
    const dateParts = Object.fromEntries(nowParts.map(part => [part.type, part.value]));
    const dataDate = new Date(Date.UTC(
        Number(dateParts.year),
        Number(dateParts.month) - 1,
        Number(dateParts.day)
    ));
    if (Number(dateParts.hour) < 9) dataDate.setUTCDate(dataDate.getUTCDate() - 1);

    const dates = [dataDate.toISOString().slice(0, 10)];
    dataDate.setUTCDate(dataDate.getUTCDate() - 1);
    dates.push(dataDate.toISOString().slice(0, 10));
    return dates;
}

async function fetchDailyOutput(suffix) {
    const dates = getDailyOutputDates();
    for (const [index, date] of dates.entries()) {
        const filename = `daily-outputs-27/${date}${suffix}`;
        const response = await fetch(filename);
        if (response.ok) {
            if (index > 0) {
                console.warn(`Latest daily output unavailable; using previous file ${filename}.`);
            }
            return {response, date};
        }
    }

    throw new Error(`No daily output file found for ${dates.join(' or ')}`);
}

async function fetchAndProcessData() {
    try {
        const [teamsResponse, playersFile] = await Promise.all([
            fetch('entries.json'),
            fetchDailyOutput('.csv')
        ]);

        if (!teamsResponse.ok) {
            throw new Error(`Entries request failed (HTTP ${teamsResponse.status})`);
        }

        const teamsData = await teamsResponse.json();
        const players = parseCsv(await playersFile.response.text())
            .filter(player => player.name !== 'DoNot Use')
            .map(player => ({
                name: player.name,
                team: player.team,
                minutes: Number(player.minutes),
                games: Number(player.games),
                points: Number(player.points),
                rebounds: Number(player.rebounds),
                assists: Number(player.assists),
                blocks: Number(player.blocks),
                steals: Number(player.steals),
                threes: Number(player.threes),
                fantasy_points: Number(player.fantasy_points),
                points_per_game: Number(player.fpg)
            }));

        const uniquePlayers = Array.from(
            new Map(players.map(p => [p.name, p])).values()
        );
        uniquePlayers.sort((a, b) => b.fantasy_points - a.fantasy_points);

        uniquePlayers.forEach((player, i) => {
            player.rank = i + 1;
        });

        return {teams: scoreTeams(teamsData, uniquePlayers), players: uniquePlayers};

    } catch(error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

function scoreTeams(teams, players) {
    const pointsByPlayer = new Map(players.map(player => [player.name, player.fantasy_points]));

    teams.forEach(team => {
        for (let pick = 1; pick <= 10; pick++) {
            team[`p${pick}_points`] = pointsByPlayer.get(team[`p${pick}`]) || 0;
        }
        team.total_score = Array.from({length: 10}, (_, index) => team[`p${index + 1}_points`])
            .reduce((total, points) => total + points, 0);
    });

    teams.sort((a, b) => b.total_score - a.total_score);
    teams.forEach((team, index) => {
        team.rank = index + 1;
    });
    return teams;
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === '"') {
            if (quoted && text[index + 1] === '"') {
                field += '"';
                index++;
            } else {
                quoted = !quoted;
            }
        } else if (character === ',' && !quoted) {
            row.push(field);
            field = '';
        } else if ((character === '\n' || character === '\r') && !quoted) {
            if (character === '\r' && text[index + 1] === '\n') index++;
            row.push(field);
            if (row.some(value => value !== '')) rows.push(row);
            row = [];
            field = '';
        } else {
            field += character;
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    const [headers, ...dataRows] = rows;
    if (!headers) throw new Error('Final player CSV is empty');
    return dataRows.map(values => Object.fromEntries(
        headers.map((header, index) => [header, values[index] || ''])
    ));
}

async function loadArchivedSeasonData() {
    const [entriesResponse, categoriesResponse, playersResponse, yesterdayResponse] = await Promise.all([
        fetch('entries.json'),
        fetch('categories.json'),
        fetch('daily-outputs/2026-04-06.csv'),
        fetch('daily-outputs/2026-04-05_daily.json')
    ]);
    const responses = [entriesResponse, categoriesResponse, playersResponse, yesterdayResponse];
    const filenames = ['entries.json', 'categories.json', 'daily-outputs/2026-04-06.csv', 'daily-outputs/2026-04-05_daily.json'];
    responses.forEach((response, index) => {
        if (!response.ok) throw new Error(`${filenames[index]} request failed (HTTP ${response.status})`);
    });

    const [teams, categories, playersCsv, yesterdayPlayers] = await Promise.all([
        entriesResponse.json(),
        categoriesResponse.json(),
        playersResponse.text(),
        yesterdayResponse.json()
    ]);
    const players = parseCsv(playersCsv)
        .filter(player => player.name !== 'DoNot Use')
        .map(player => ({
            name: player.name,
            team: player.team,
            minutes: Number(player.minutes),
            games: Number(player.games),
            points: Number(player.points),
            rebounds: Number(player.rebounds),
            assists: Number(player.assists),
            blocks: Number(player.blocks),
            steals: Number(player.steals),
            threes: Number(player.threes),
            fantasy_points: Number(player.fantasy_points),
            points_per_game: Number(player.fpg)
        }))
        .sort((a, b) => b.fantasy_points - a.fantasy_points);
    players.forEach((player, index) => {
        player.rank = index + 1;
    });

    return {
        teams: scoreTeams(teams, players),
        players,
        categories,
        yesterdayPlayers
    };
}

async function loadSeason(season) {
    const loadId = ++seasonLoadId;
    const isArchivedSeason = season === '2025-26';
    const seasonDescription = document.getElementById('season-description');
    seasonDescription.textContent = isArchivedSeason ? '2025-26 Final Standings' : '2026-27 Full Season Standings';
    document.title = `Fantasy Big Ten Basketball Standings (${season})`;
    document.getElementById('loading').textContent = `Loading ${season} Standings...`;
    document.getElementById('loading').style.display = 'block';
    document.getElementById('error').style.display = 'none';
    document.getElementById('content').style.display = 'none';
    tableSortStates.forEach(sort => {
        sort.column = null;
        sort.direction = 'desc';
    });
    document.querySelectorAll('.full-table th.sortable').forEach(header => {
        header.classList.remove('sort-asc', 'sort-desc');
    });

    try {
        const data = isArchivedSeason
            ? await loadArchivedSeasonData()
            : await fetchAndProcessData();
        if (loadId !== seasonLoadId) return;

        teamsData = data.teams;
        playersData = data.players;

        if (isArchivedSeason) {
            positionCategories = data.categories;
            yesterdayPlayersData = data.yesterdayPlayers;
            populateYesterdayPlayers(yesterdayPlayersData.slice(0, 5));
            document.getElementById('yesterday-date').textContent = 'Sunday, April 5, 2026 (Championship Game)';
        } else {
            await loadYesterdayData();
            await loadCategories();
            if (loadId !== seasonLoadId) return;
        }

        populateTopTeams(teamsData.slice(0, 5));
        populateTopPlayers(playersData.slice(0, 10));
        populateTopByCategory();
        populateFullTeams(teamsData);
        populateFullPlayers(playersData);

        if (!tableSortingInitialized) {
            setupTableSorting('teams-table', populateFullTeams);
            setupTableSorting('players-table', populateFullPlayers);
            tableSortingInitialized = true;
        }

        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    } catch(error) {
        if (loadId !== seasonLoadId) return;
        console.error('Error loading data:', error)
        document.getElementById('loading').style.display = 'none';
        const errorDiv = document.getElementById('error')
        errorDiv.textContent = `Error loading data: ${error.message}. Contact Ari with a bug report.`
        errorDiv.style.display = 'block';
    }
}

async function loadYesterdayData() {
    try {
        const dailyFile = await fetchDailyOutput('_daily.json');
        yesterdayPlayersData = await dailyFile.response.json()
        populateYesterdayPlayers(yesterdayPlayersData.slice(0, 5));

        const dateStr = new Date(`${dailyFile.date}T00:00:00Z`).toLocaleDateString('en-US', {
            timeZone: 'UTC',
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

function setupTableSorting(tableId, populateFunction) {
    const table = document.getElementById(tableId);
    const headers = table.querySelectorAll('th.sortable');
    tableSortStates.set(tableId, {column: null, direction: 'desc'});

    headers.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.column;
            const type = header.dataset.type;
            const currentSort = tableSortStates.get(tableId);

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

            const data = tableId === 'teams-table' ? teamsData : playersData;
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
        <td class="points">${team.total_score.toLocaleString('en-US')}</td>
    </tr>
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
            </tr>
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
            </tr>
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

document.querySelectorAll('.season-button').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.season-button').forEach(seasonButton => {
            const isSelected = seasonButton === button;
            seasonButton.classList.toggle('is-active', isSelected);
            seasonButton.setAttribute('aria-pressed', String(isSelected));
        });
        loadSeason(button.dataset.season);
    });
});

loadSeason('2026-27');