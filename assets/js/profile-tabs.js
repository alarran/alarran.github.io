/* Highlights the home page tab for the section currently in view. */
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('.profile-tabs a'));
  var sections = links.map(function (a) {
    return a.hash ? document.getElementById(a.hash.slice(1)) : null;
  });
  if (!sections.some(Boolean)) return;

  function update() {
    var offset = window.scrollY + 120;
    var current = 0;
    sections.forEach(function (section, i) {
      if (section && section.getBoundingClientRect().top + window.scrollY <= offset) current = i;
    });
    /* At the very bottom, the last section may be too short to reach the offset */
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      current = sections.length - 1;
    }
    links.forEach(function (a, i) {
      a.classList.toggle('active', i === current);
    });
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
