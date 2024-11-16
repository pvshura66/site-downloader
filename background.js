importScripts('md5.js');

let visitedUrls = new Set();  // Store URLs that have already been visited
let linksToVisit = new Set();  // Store links to visit next
let linksToSkip = new Set();  // Visit but do not save
let runningLinks = new Set();
let counter = 0;

// Simple lock non-reenterable
let _access = 0;
async function lock() {
  while( ++_access !== 1 ) {
    _access--;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
function unlock() {
  _access--;
}

// Function to save the current page as MHTML
function savePageAsMHTML(tabId, url) {
  return new Promise((resolve, reject) => {
    chrome.pageCapture.saveAsMHTML({ tabId: tabId }, async (blob) => {
      try {
        const content = await blob.text();
        const blob_url = "data:application/x-mimearchive;base64," + btoa(content);
        const filename = hex_md5(url) + '.mhtml';
        await chrome.downloads.download({ url: blob_url, filename: filename, conflictAction: 'overwrite' }, (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(downloadId);
          }
        });
      } catch(error){
        reject(error.message);
      }
    });
  });
}

async function exportSettings(){
//  lock();
  settings = { 'visitedUrls': Array.from( visitedUrls ), 'linksToVisit': Array.from( linksToVisit ), 'linksToSkip': Array.from( linksToSkip )};
//  unlock();
  const dataStr = JSON.stringify(settings, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  blob.text().then((content) => {
    const blob_url = "data:application/x-mimearchive;base64," + btoa(content);
    chrome.downloads.download({ url: blob_url, filename: 'urlLists.json', conflictAction: 'overwrite' }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Error downloading urls:", error);
      } else {
        let pct = ( settings.visitedUrls.length + settings.linksToVisit.length > 0 ) ? settings.visitedUrls.length / ( settings.visitedUrls.length + settings.linksToVisit.length ) * 100 : 100;
        console.warn('# %s percent complete, %d links left', pct.toFixed(2), settings.linksToVisit.length);
      }
    });
    }).catch((error) => {
      console.error("Error reading blob:", error);
  });
}

// Function to get new links from the current page
function getNewLinksFromPage(currentTabId, mask) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(currentTabId, { message: "getLinksByMask", mask: mask }, (response) => {
      if (response && response.links) {
        resolve(response.links);
      } else {
        reject("No links found on the page.");
      }
    });
  });
}

// Function to navigate to a new URL and wait for page to load using Promises
function navigateAndWaitForLoad(tabId, url, urlMask, paramList) {
    chrome.tabs.update(tabId, { url: url });

    // Listen for the tab update event to check if the page has finished loading
    function listener(updatedTabId, changeInfo) {
        // Check if the updated tab is the correct tab and the page has finished loading
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
            // Remove the listener once the page is fully loaded
            chrome.tabs.onUpdated.removeListener(listener);
            visitNextLink(url, tabId, urlMask, paramList);
        }
    }

    // Add listener to detect when the page has finished loading
    chrome.tabs.onUpdated.addListener(listener);
}

function cleanUrl(link, params_delete) {
  const new_url = new URL(link);
  for( const param of params_delete ) {
    new_url.searchParams.delete(param);
  }
  new_url.hash = '';
  return new_url.toString();
}

// Function to visit all links and save the pages
async function visitNextLink(currentUrl, currentTabId, urlMask, paramList) {  
  let url = currentUrl; // clean twice
  console.log(url);

  let newLinks = null;
  try {
    if( linksToSkip.has(url)){ // Do not save
      newLinks = await getNewLinksFromPage(currentTabId, urlMask);
    } else {
      const results = await Promise.all([getNewLinksFromPage(currentTabId, urlMask), savePageAsMHTML(currentTabId, url)]);
      newLinks = results[0];
    }
  } catch(error) {
    console.error(error);
    navigateAndWaitForLoad(currentTabId, url, urlMask, paramList);
    return;
  }

  newLinks.forEach((link, index, array) => {
    array[index] = cleanUrl(link, paramList);
  });

  // Add new links without duplicates, Filter out already visited links
  await lock();
  try {
    runningLinks.delete(url);
    visitedUrls.add(url);  // Mark this link as visited 
    linksToVisit = linksToVisit.union(new Set(newLinks).difference(visitedUrls));
    linksToVisit.delete(url);
    chrome.storage.local.set({ 'visitedUrls': [...visitedUrls]});
    chrome.storage.local.set({ 'linksToVisit': [...linksToVisit]});

    if( ++counter % 100 === 0 ) {
      exportSettings();
    }

    for( let url of linksToVisit ) {
      try {
        new_url = cleanUrl(url, paramList);
        if( !runningLinks.has(new_url)) {
            if( new_url !== url ){
              linksToVisit.delete(url);
              linksToVisit.add(new_url);
              url = new_url;
            }
            runningLinks.add(url);
          navigateAndWaitForLoad(currentTabId, url, urlMask, paramList);
          return; // Navigate to the next link after saving
        }
      } catch (error) {
        console.error("Error %s navigating to the page %s", error.toString(), url);
      }
    }
  } finally {
    unlock();
  }
  console.log('Download finished.');
}

function readStorage(storage, key) {
  return new Promise((resolve, reject) => {
    storage.get([key], function (result) {
      if (result[key] === undefined) {
        resolve([]);
      } else {
        resolve(result[key]);
      }
    });
  });
}

// Listen for the user clicking the extension icon
chrome.action.onClicked.addListener(async (tab) => {
    try {
      // Retrieve the URL mask from storage
      const results = await Promise.all([readStorage( chrome.storage.sync, "urlMask" ), readStorage( chrome.storage.sync, "paramList" )]);
      let urlMask = results[0] || "*";  // Use the saved mask or a default mask
      let paramList = results[1].split(',').map(element => element.replace(/"/g, ''));
      await lock();
      if( counter === 0 ) {
        const results = await Promise.all([readStorage( chrome.storage.local, "visitedUrls" ), readStorage( chrome.storage.local, "linksToVisit" ), readStorage( chrome.storage.local, "linksToSkip" )]);
        visitedUrls = new Set(results[0]);
        linksToVisit = new Set(results[1]);
        linksToSkip = new Set(results[2]);
      }
      let pct = ( visitedUrls.size + linksToVisit.size > 0 ) ? visitedUrls.size / ( visitedUrls.size + linksToVisit.size ) * 100 : 100;
      let sz = linksToVisit.size;
      unlock();
      console.warn('# %s percent complete, %d links left', pct.toFixed(2), sz );

      visitNextLink( tab.url, tab.id, urlMask, paramList );  // Start visiting links
    } catch(error) {
      console.error(error);
    }
});
