/**
 * DFS 기반 랜덤 미로 생성
 * grid: 0 = 통로, 1 = 벽
 * 크기는 항상 홀수 (벽+통로 패턴)
 */

const WALL = 1;
const PATH = 0;

/**
 * @param {number} playerCount
 * @returns {{ rows: number, cols: number }} - 홀수 크기
 */
export function getMazeSize(playerCount) {
  if (playerCount <= 3) return { rows: 15, cols: 15 };   // 소형
  if (playerCount <= 5) return { rows: 21, cols: 21 };   // 중형
  return { rows: 27, cols: 27 };                         // 대형
}

/**
 * @param {number} rows - 홀수
 * @param {number} cols - 홀수
 * @returns {number[][]} 2D grid, 0=path 1=wall
 */
export function generateMaze(rows, cols) {
  if (rows % 2 === 0) rows++;
  if (cols % 2 === 0) cols++;

  const grid = Array(rows)
    .fill(null)
    .map(() => Array(cols).fill(WALL));

  const startRow = 1;
  const startCol = 1;
  dfs(grid, startRow, startCol, rows, cols);

  addLoops(grid, rows, cols);
  return grid;
}

/**
 * 벽 중 '양쪽이 통로'인 곳 일부를 뚫어 루프를 만듦 → 경로가 다양해져 더 자연스러운 미로
 */
function addLoops(grid, rows, cols) {
  const candidates = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] !== WALL) continue;
      const leftRight = grid[r][c - 1] === PATH && grid[r][c + 1] === PATH;
      const upDown = grid[r - 1][c] === PATH && grid[r + 1][c] === PATH;
      if (leftRight || upDown) candidates.push({ row: r, col: c });
    }
  }
  shuffle(candidates);
  const removeCount = Math.floor(candidates.length * 0.2); // 20% 정도 뚫어 루프 추가
  for (let i = 0; i < removeCount && i < candidates.length; i++) {
    const { row, col } = candidates[i];
    grid[row][col] = PATH;
  }
}

function dfs(grid, r, c, rows, cols) {
  grid[r][c] = PATH;
  const dirs = [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
  ];
  shuffle(dirs);

  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 1 && nr < rows - 1 && nc >= 1 && nc < cols - 1 && grid[nr][nc] === WALL) {
      grid[(r + nr) / 2][(c + nc) / 2] = PATH;
      dfs(grid, nr, nc, rows, cols);
    }
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * 그리드에서 통로(PATH)인 셀 중 랜덤 좌표 목록 반환 (중복 없음)
 * @param {number[][]} grid
 * @param {number} count
 * @returns {{ row: number, col: number }[]}
 */
export function getRandomPathCells(grid, count) {
  const cells = [];
  const rows = grid.length;
  const cols = grid[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === PATH) cells.push({ row: r, col: c });
    }
  }
  shuffle(cells);
  return cells.slice(0, count);
}
