(function () {
  const chips = document.querySelectorAll('.tag-chips .chip');
  const cards = document.querySelectorAll('.card[data-tags]');
  const sections = document.querySelectorAll('.year-section');

  function applyFilter(tag) {
    cards.forEach(card => {
      const tags = (card.dataset.tags || '').split(/\s+/).filter(Boolean);
      card.hidden = tag !== 'all' && !tags.includes(tag);
    });
    sections.forEach(s => {
      const visible = s.querySelectorAll('.card:not([hidden])').length;
      s.dataset.empty = visible === 0 ? 'true' : 'false';
    });
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.toggle('active', c === chip));
      applyFilter(chip.dataset.tag);
    });
  });

  // Hide tag chips that have zero matching cards on initial load.
  chips.forEach(chip => {
    const tag = chip.dataset.tag;
    if (tag === 'all') return;
    const count = Array.from(cards).filter(card => {
      const tags = (card.dataset.tags || '').split(/\s+/).filter(Boolean);
      return tags.includes(tag);
    }).length;
    if (count === 0) chip.hidden = true;
  });
})();
