/* Opens a publication's details popup when its title is clicked. */
(function () {
  if (typeof HTMLDialogElement !== 'function') return; /* old browsers: links go to the paper's page */

  document.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-dialog]');
    if (opener) {
      var dialog = document.getElementById(opener.getAttribute('data-dialog'));
      if (dialog) {
        event.preventDefault();
        dialog.showModal();
      }
      return;
    }

    if (event.target.closest('.pub-dialog__close')) {
      event.target.closest('dialog').close();
      return;
    }

    /* The content sits in an inner box, so a click that lands on the dialog itself is on the dimmed backdrop */
    if (event.target.tagName === 'DIALOG' && event.target.open) {
      event.target.close();
    }
  });
})();
