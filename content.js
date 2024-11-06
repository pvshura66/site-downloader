// Function to find all links that match a given URL mask
function getLinksByMask(mask) {
  const allLinks = Array.from(document.querySelectorAll('a')).map(link => link.href);
  const regex = new RegExp(mask);
  return allLinks.filter(link => regex.test(link));
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === "getLinksByMask") {
    const links = getLinksByMask(request.mask);
    sendResponse({ links: links });
  }
});
