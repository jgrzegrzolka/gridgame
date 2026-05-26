import { useState, useEffect, useRef, useCallback } from "react";
import { flags, criteriaDefinitions, buildGrid } from "./flagData";
import "./App.css";

const GRID_SIZE = 3;

function normalise(str) {
  return str.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

function Autocomplete({ onSubmit, disabled, usedNames }) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  function handleChange(e) {
    const v = e.target.value;
    setValue(v);
    setHighlighted(-1);
    if (v.length < 1) { setSuggestions([]); return; }
    const norm = normalise(v);
    setSuggestions(
      flags
        .filter(f => normalise(f.name).includes(norm))
        .slice(0, 6)
    );
  }

  function submit(name) {
    setValue("");
    setSuggestions([]);
    setHighlighted(-1);
    onSubmit(name);
  }

  function handleKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)); }
    else if (e.key === "Enter") {
      if (highlighted >= 0 && suggestions[highlighted]) submit(suggestions[highlighted].name);
      else if (value.trim()) submit(value.trim());
    }
    else if (e.key === "Escape") { setSuggestions([]); setHighlighted(-1); }
  }

  return (
    <div className="autocomplete-wrap">
      <input
        ref={inputRef}
        className="answer-input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder="Type a country…"
        disabled={disabled}
        autoComplete="off"
      />
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((f, i) => (
            <li
              key={f.name}
              className={`suggestion-item ${i === highlighted ? "highlighted" : ""} ${usedNames.has(f.name) ? "used" : ""}`}
              onMouseDown={() => submit(f.name)}
            >
              {f.name}
              {usedNames.has(f.name) && <span className="used-tag">used</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Cell({ cell, answer, isActive, onClick, rowLabel, colLabel }) {
  const status = answer
    ? answer.correct ? "correct" : "wrong"
    : isActive ? "active" : "idle";

  return (
    <div className={`cell cell-${status}`} onClick={!answer ? onClick : undefined}>
      {answer ? (
        <div className="cell-answer">
          <span className={`cell-result-icon ${answer.correct ? "icon-correct" : "icon-wrong"}`}>
            {answer.correct ? "✓" : "✗"}
          </span>
          <span className="cell-country">{answer.name}</span>
        </div>
      ) : isActive ? (
        <div className="cell-hint">
          <span className="cell-hint-row">{rowLabel}</span>
          <span className="cell-hint-plus">×</span>
          <span className="cell-hint-col">{colLabel}</span>
        </div>
      ) : (
        <span className="cell-tap">tap to answer</span>
      )}
    </div>
  );
}

export default function App() {
  const [gameData, setGameData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [activeCell, setActiveCell] = useState(null);
  const [score, setScore] = useState(0);
  const [wrongFlash, setWrongFlash] = useState(false);
  const usedNames = new Set(Object.values(answers).map(a => a.name));

  function startGame() {
    const data = buildGrid(GRID_SIZE);
    setGameData(data);
    setAnswers({});
    setActiveCell(null);
    setScore(0);
  }

  useEffect(() => { startGame(); }, []);

  function handleCellClick(idx) {
    setActiveCell(idx);
  }

  function handleSubmit(name) {
    if (activeCell === null || !gameData) return;
    const cell = gameData.grid[activeCell];
    const isCorrect = cell.validFlags.some(f => normalise(f.name) === normalise(name));
    const newAnswer = { name, correct: isCorrect };
    setAnswers(prev => ({ ...prev, [activeCell]: newAnswer }));
    if (isCorrect) {
      setScore(s => s + 1);
      const nextEmpty = gameData.grid.findIndex((_, i) => i !== activeCell && !answers[i] && answers[i] !== 0);
      setActiveCell(nextEmpty === -1 ? null : nextEmpty);
    } else {
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 600);
    }
  }

  const totalCells = GRID_SIZE * GRID_SIZE;
  const answered = Object.keys(answers).length;
  const allDone = answered === totalCells;

  if (!gameData) return <div className="loading">Loading…</div>;

  const { rowKeys, colKeys, grid } = gameData;

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Flag Grid</h1>
        <p className="subtitle">Name a country whose flag matches both criteria</p>
      </header>

      <div className="score-bar">
        <span className="score">{score} / {totalCells}</span>
        <button className="btn-new" onClick={startGame}>New game</button>
      </div>

      <div className="grid-wrap">
        <div className="grid" style={{ gridTemplateColumns: `140px repeat(${GRID_SIZE}, 1fr)` }}>
          <div className="corner-cell" />
          {colKeys.map(k => (
            <div key={k} className="header-cell col-header">
              {criteriaDefinitions[k].label}
            </div>
          ))}

          {rowKeys.map((rk, r) => (
            <>
              <div key={rk} className="header-cell row-header">
                {criteriaDefinitions[rk].label}
              </div>
              {colKeys.map((ck, c) => {
                const idx = r * GRID_SIZE + c;
                return (
                  <Cell
                    key={idx}
                    cell={grid[idx]}
                    answer={answers[idx]}
                    isActive={activeCell === idx}
                    onClick={() => handleCellClick(idx)}
                    rowLabel={criteriaDefinitions[rk].label}
                    colLabel={criteriaDefinitions[ck].label}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      {activeCell !== null && !answers[activeCell] && (
        <div className={`input-area ${wrongFlash ? "flash-wrong" : ""}`}>
          <div className="active-clue">
            <span className="clue-tag">{criteriaDefinitions[rowKeys[Math.floor(activeCell / GRID_SIZE)]].label}</span>
            <span className="clue-sep">+</span>
            <span className="clue-tag">{criteriaDefinitions[colKeys[activeCell % GRID_SIZE]].label}</span>
          </div>
          <Autocomplete onSubmit={handleSubmit} disabled={false} usedNames={usedNames} />
        </div>
      )}

      {allDone && (
        <div className="result-banner">
          <p className="result-text">
            {score === totalCells ? "🎉 Perfect score!" : `${score} of ${totalCells} correct`}
          </p>
          <button className="btn-new btn-large" onClick={startGame}>Play again</button>
        </div>
      )}
    </div>
  );
}
