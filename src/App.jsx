import { useState, useEffect, useRef, Fragment } from "react";
import { flags, criteria, rowKeys, colKeys, buildGrid, normalise } from "./flagData";
import "./App.css";

const SIZE = 3;
const GAME_HASH = "#/1";

function Autocomplete({ onSubmit, usedNames }) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleChange(e) {
    const v = e.target.value;
    setValue(v);
    setHighlighted(-1);
    if (v.length < 1) { setSuggestions([]); return; }
    const norm = normalise(v);
    setSuggestions(flags.filter(f => normalise(f.name).includes(norm)).slice(0, 6));
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

function Cell({ answer, isActive, onClick, rowLabel, colLabel }) {
  const status = answer ? (answer.correct ? "correct" : "wrong") : isActive ? "active" : "idle";
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
  useEffect(() => {
    if (window.location.hash !== GAME_HASH) {
      window.history.replaceState(null, "", GAME_HASH);
    }
  }, []);

  const [grid] = useState(() => buildGrid());
  const [answers, setAnswers] = useState({});
  const [activeCell, setActiveCell] = useState(null);
  const [wrongFlash, setWrongFlash] = useState(false);

  const usedNames = new Set(Object.values(answers).map(a => a.name));
  const totalCells = SIZE * SIZE;
  const answered = Object.keys(answers).length;
  const score = Object.values(answers).filter(a => a.correct).length;
  const allDone = answered === totalCells;

  function handleSubmit(name) {
    if (activeCell === null) return;
    const cell = grid[activeCell];
    const correct = cell.validFlags.some(f => normalise(f.name) === normalise(name));
    setAnswers(prev => ({ ...prev, [activeCell]: { name, correct } }));
    if (correct) {
      const next = grid.findIndex((_, i) => i !== activeCell && !answers[i]);
      setActiveCell(next === -1 ? null : next);
    } else {
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 600);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Flag Grid</h1>
        <p className="subtitle">Name a country whose flag matches both criteria</p>
      </header>

      <div className="score-bar">
        <span className="score">{score} / {totalCells}</span>
      </div>

      <div className="grid-wrap">
        <div className="grid" style={{ gridTemplateColumns: `140px repeat(${SIZE}, 1fr)` }}>
          <div className="corner-cell" />
          {colKeys.map(k => (
            <div key={k} className="header-cell col-header">{criteria[k].label}</div>
          ))}

          {rowKeys.map((rk, r) => (
            <Fragment key={rk}>
              <div className="header-cell row-header">{criteria[rk].label}</div>
              {colKeys.map((ck, c) => {
                const idx = r * SIZE + c;
                return (
                  <Cell
                    key={idx}
                    answer={answers[idx]}
                    isActive={activeCell === idx}
                    onClick={() => setActiveCell(idx)}
                    rowLabel={criteria[rk].label}
                    colLabel={criteria[ck].label}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {activeCell !== null && !answers[activeCell] && (
        <div className={`input-area ${wrongFlash ? "flash-wrong" : ""}`}>
          <div className="active-clue">
            <span className="clue-tag">{criteria[rowKeys[Math.floor(activeCell / SIZE)]].label}</span>
            <span className="clue-sep">+</span>
            <span className="clue-tag">{criteria[colKeys[activeCell % SIZE]].label}</span>
          </div>
          <Autocomplete onSubmit={handleSubmit} usedNames={usedNames} />
        </div>
      )}

      {allDone && (
        <div className="result-banner">
          <p className="result-text">
            {score === totalCells ? "Perfect score!" : `${score} of ${totalCells} correct`}
          </p>
        </div>
      )}
    </div>
  );
}
