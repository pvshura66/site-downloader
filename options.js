document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("settings-form");
  const maskInput = document.getElementById("url-mask");
  const paramsInput = document.getElementById("params");

  // Load the saved URL mask from storage
  chrome.storage.sync.get(["urlMask", "paramList"], (result) => {
    if (result.urlMask) {
      maskInput.value = result.urlMask;
    }
    if (result.paramList) {
      paramsInput.value = result.paramList;
    }
  });

  // Handle form submission
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const urlMask = maskInput.value;
    const paramList = paramsInput.value;

    // Save the URL mask to storage
    chrome.storage.sync.set({ urlMask: urlMask, paramList: paramList}, () => {
      alert("Parameters saved!");
    });
  });

  // Export lists as JSON
  document.getElementById('export').addEventListener('click', () => {
    chrome.storage.local.get(['visitedUrls', 'linksToVisit', 'linksToSkip'], (result) => {
      const dataStr = JSON.stringify(result, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'urlLists.json';
      a.click();
    });
  });

  // Import lists from JSON
  document.getElementById('import').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        chrome.storage.local.set({ visitedUrls: json.visitedUrls, linksToVisit: json.linksToVisit, linksToSkip: json.linksToSkip }, () => {
          alert('Lists imported and saved!');
        });
      } catch (err) {
        alert('Invalid JSON file!');
      }
    };

    reader.readAsText(file);
  });
});
