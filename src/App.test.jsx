import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('renders the title and all six criterion headers', () => {
    render(<App />);
    expect(screen.getByText('Flag Grid')).toBeInTheDocument();
    expect(screen.getByText('Has red')).toBeInTheDocument();
    expect(screen.getByText('Has green')).toBeInTheDocument();
    expect(screen.getByText('Has 4+ colors')).toBeInTheDocument();
    expect(screen.getByText('Has an animal')).toBeInTheDocument();
    expect(screen.getByText('Has coat of arms')).toBeInTheDocument();
    expect(screen.getByText('No white')).toBeInTheDocument();
  });

  it('redirects to #/1 on mount', () => {
    render(<App />);
    expect(window.location.hash).toBe('#/1');
  });

  it('clicking a cell shows the autocomplete input', async () => {
    const user = userEvent.setup();
    render(<App />);
    const cells = screen.getAllByText('tap to answer');
    await user.click(cells[0]);
    expect(screen.getByPlaceholderText(/type a country/i)).toBeInTheDocument();
  });

  it('typing in autocomplete shows matching suggestions', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getAllByText('tap to answer')[0]);
    const input = screen.getByPlaceholderText(/type a country/i);
    await user.type(input, 'mex');
    expect(screen.getByText('Mexico')).toBeInTheDocument();
  });

  it('a correct answer marks the cell correct and advances to the next', async () => {
    const user = userEvent.setup();
    render(<App />);
    // first cell is hasRed × hasAnimal → Mexico is valid
    const cells = screen.getAllByText('tap to answer');
    await user.click(cells[0]);
    const input = screen.getByPlaceholderText(/type a country/i);
    await user.type(input, 'Mexico{Enter}');
    expect(screen.getByText('Mexico')).toBeInTheDocument();
    expect(screen.getByText('1 / 9')).toBeInTheDocument();
  });

  it('a wrong answer marks the cell wrong', async () => {
    const user = userEvent.setup();
    render(<App />);
    // first cell is hasRed × hasAnimal → Japan (red+white, no animal) is wrong
    await user.click(screen.getAllByText('tap to answer')[0]);
    const input = screen.getByPlaceholderText(/type a country/i);
    await user.type(input, 'Japan{Enter}');
    expect(screen.getByText('Japan')).toBeInTheDocument();
    expect(screen.getByText('0 / 9')).toBeInTheDocument();
  });
});
