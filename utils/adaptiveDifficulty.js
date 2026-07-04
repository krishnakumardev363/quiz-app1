// Simple adaptive difficulty helper.
// Given whether the last answer was correct, decide the next question's difficulty.

const DIFFICULTY_LEVELS = ["easy", "medium", "hard"];

/**
 * Returns the next difficulty level based on current difficulty and correctness.
 * - Correct answer -> move up one level (if not already hard)
 * - Wrong answer -> move down one level (if not already easy)
 */
export const getNextDifficulty = (currentDifficulty, wasCorrect) => {
  const currentIndex = DIFFICULTY_LEVELS.indexOf(currentDifficulty);
  const safeIndex = currentIndex === -1 ? 1 : currentIndex; // default to medium if unknown

  let nextIndex = safeIndex;
  if (wasCorrect) {
    nextIndex = Math.min(safeIndex + 1, DIFFICULTY_LEVELS.length - 1);
  } else {
    nextIndex = Math.max(safeIndex - 1, 0);
  }

  return DIFFICULTY_LEVELS[nextIndex];
};

/**
 * Picks a random question from a pool matching the target difficulty.
 * Falls back to the closest available difficulty if none match exactly.
 */
export const pickQuestionByDifficulty = (questionPool, targetDifficulty, usedIds = []) => {
  const available = questionPool.filter(
    (q) => !usedIds.includes(q._id.toString())
  );

  let candidates = available.filter((q) => q.difficulty === targetDifficulty);

  // Fallback: if no questions left at target difficulty, use any remaining question
  if (candidates.length === 0) {
    candidates = available;
  }

  if (candidates.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
};

/**
 * Fisher-Yates shuffle - used to randomize question order and options.
 */
export const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
