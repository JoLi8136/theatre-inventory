// Inventory Data
let allData = [];
let groupData = [];
let filteredData = [];
let activeType = '';
let activeCategory = '';
let searchQuery = '';
let activeGroup = null;

const CHECKOUT_URL = 'https://script.google.com/macros/s/AKfycbzafJii9wFpoHEr50JElZDlgKUBLhCx8-zFfY-6-aFxSs_axqgx-UqgwtfaLqI_ZpX3/exec';
let checkoutStatus = {};
let borrowStatus = {};
let selectedItems = new Set();
let emailConfig = {};

// Separate catalogues by groups
const GROUP_CONFIG = {
  'ensemble': {
    name: 'Ensemble',
    url: 'https://script.google.com/macros/s/AKfycbwdRHLILnY9v7ZBY607JBrRhLxdhV6hFSOkCZQrhKQ42_vuHaDHiehrftk2Hrvn48m4fA/exec',
    types: ['Props', 'Equipment', 'Hats', 'Costumes', 'Accessories']
  },
  'musicalforum': {
    name: 'Musical Forum',
    url: 'https://script.google.com/macros/s/AKfycbws_PeLtRVyZZLePCGrzWMvztMiuY2SZbJFv_IBCB6rFdJzd5x7Ywx9-Hf11G3AKVO8nA/exec',
    types: ['Resources', 'Props', 'Costumes', 'Lights/Sound', 'Instruments/Music']
  },
  'btc': {
    name: 'BTC',
    url: '',
    types: ['Props', 'Costumes', 'Set Pieces']
  }
};

// URL
const params = new URLSearchParams(window.location.search);
const slug = params.get('group');

if (slug && !GROUP_CONFIG[slug]) {
    document.body.innerHTML = '<p>Page not found.</p>';
    throw new Error('Unknown group');
}

const typeSelect = document.getElementById('type-filter');
const categorySelect = document.getElementById('category-filter');
const searchInput = document.getElementById('search');

// Filter type
if (typeSelect) {
    typeSelect.addEventListener('change', () => {
        activeType = typeSelect.value;
        buildCategoryDropDown();
        applyUserFilters();
    });
}

if (categorySelect) {
    categorySelect.addEventListener('change', () => {
        activeCategory = categorySelect.value;
        applyUserFilters();
    })
}

// Filter search
if (searchInput) {
    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        applyUserFilters();
    });
}

// DATA LOADING
async function loadInventory() {
    try {
        const groupWithUrls = Object.entries(GROUP_CONFIG).filter(([,g]) => g.url);
        
        await Promise.all(groupWithUrls.map(async([slug,g]) => {
            const res = await fetch(g.url);
            const sheetData = await res.json();
            allData[slug] = Object.values(sheetData).flat().filter(item => {
                const name = item.item;
                return name && name.toString().trim() !== '' &&
                    !name.toString().toLowerCase().includes('null');
            }).map(item => ({ ...item, _group: slug }));
            console.log("first item in allData:", allData[slug]?.[0]);
        }));
        
        await Promise.all([loadCheckouts(), loadEmailConfig()]);
        applyGroupFilter();

    } catch (err) {
        console.error("Failed to load inventory:", err);
    }
}

// GROUP FILTERING
function setGroup (slug) {
    activeGroup = slug || null;
    
    document.querySelectorAll('#group-nav button').forEach(btn => btn.classList.remove('active'));
    const activeBtn = activeGroup
        ? document.getElementById(`btn-${activeGroup}`)
        : document.getElementById('btn-all');
    if (activeBtn) activeBtn.classList.add('active');

    const newUrl = activeGroup
        ? `${window.location.pathname}?group=${activeGroup}`
        : window.location.pathname;
    window.history.pushState({}, '', newUrl);

    activeType = '';
    activeCategory = '';
    searchQuery = '';
    if (typeSelect) typeSelect.value = '';
    if (categorySelect) categorySelect.value = '';
    if (searchInput) searchInput.value = '';

    clearSelection();
    applyGroupFilter();
}

function applyGroupFilter() {
    groupData = activeGroup
        ? (allData[activeGroup] || [])
        : Object.values(allData).flat();

    groupData.sort((a,b) => (a.item || '').localeCompare(b.item || ''));
    buildTypeDropDown();
    buildCategoryDropDown();
    applyUserFilters();
}

// Type Dropdown
function buildTypeDropDown() {
    const types = [...new Set(groupData.map(item => item._type))].sort();
    typeSelect.innerHTML = '<option value="">All types</option>';
    types.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        typeSelect.appendChild(option);
    });
}

// Category Dropdown
function buildCategoryDropDown() {
    const sourceItems = activeType ? groupData.filter(item => item._type === activeType) : groupData;
    const categories = [...new Set(sourceItems.map(item => item.category).filter(cat => cat && cat.toString().trim() !== ''))].sort();
    
    categorySelect.innerHTML = '<option value="">All categories</option>';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categorySelect.appendChild(option);
    });

    activeCategory = '';
    categorySelect.value = '';
}
// User filter for type
function applyUserFilters() {
    filteredData = groupData.filter(item => {
        const matchesType =!activeType || item._type === activeType;
        const matchesCategory =!activeCategory || item.category === activeCategory;
        const matchesSearch = !searchQuery || [
            item.item,
            item.tags,
        ].some(field =>
            field && field.toString().toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesType && matchesCategory && matchesSearch;
    });
    displayInventory(filteredData);
}

// Get images
function getDriveImageUrl(url) {
    if (!url || url.toString().trim() === '') return '';
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
        return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w400`;
    }
    return `https://drive.google.com/thumbnail?id=${url}&sz=w400`;
}

// Display inventory in cards and modals
function displayInventory(items) {
    const loadingMsg = document.getElementById('loading-msg');
    if (loadingMsg) loadingMsg.style.display = 'none';

    const container = document.getElementById("inventory-container");
    container.innerHTML = "";

    const statusColors = {
        available: '#22c55e',
        used: '#f97316',
        borrowed: '#3b82f6',
    };
    const statusLabels = {
        available: 'Available',
        used: 'In Use',
        borrowed: 'Borrowed',
    }; 

    items.forEach(item => {
        const globalIndex = groupData.indexOf(item);
        const itemId = `${item._group}-${globalIndex}`;
        const status = getItemStatus(itemId);
        const isSelected = selectedItems.has(itemId);

        const card = document.createElement('div');
        card.className = 'card';
        if (isSelected) card.classList.add('selected');

        card.innerHTML += `
            <button class="card-select-btn ${isSelected ? 'selected' : ''}"
                aria-label="Select item" title="Select"> 
                ${isSelected ? '✓' : ''}
            </button>
            <div class ="status-badge" style="background:${statusColors[status]}">
                ${statusLabels[status]}
            </div>
            <img src="${getDriveImageUrl(item.image)}" "alt="${item.item}" loading="lazy">
            <h2>${item.item}</h2>
            <p>${item._type}</p>
            ${item.location ? `<p>${item.location}</p>` : ''}
            ${item.tags ? `<p class ="tags"><strong>Tags:</strong> ${item.tags}</p>` :""}
        `;
        
        card.querySelector('.card-select-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSelectItem(itemId, card, card.querySelector('.card-select-btn'));
        });
    
        card.addEventListener('click', (e) => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                e.preventDefault();
                toggleSelectItem(itemId, card, card.querySelector('.card-select-btn'));
            } else {
                openModal(globalIndex, itemId);
            }
        });

        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            toggleSelectItem(itemId, card, card.querySelector('.card-select-btn'));
        });

        container.appendChild(card);
    });
}

// Modal
function openModal(index, itemId) {
    if (index === null || index === undefined) { return; }
    const item = groupData[index];
    if (!item) { return; }
    
    const id = itemId || `${item._group}-${index}`;
    const status = getItemStatus(id);
    const checkoutInfo = checkoutStatus[id];
    const borrowInfo = borrowStatus[id];

    const defaultFields = ['item', 'image', '_type', 'quantity', '_group'];

    const fields = Object.entries(item)
        .filter(([key]) => !defaultFields.includes(key))
        .map(([key,value]) => field(
            key.charAt(0).toUpperCase() + key.slice(1), value))
            .join('');

    let statusSection = '';
    if (status === 'used') {
        statusSection = `
            <p><strong>Status:</strong> In Use for <em>${checkoutInfo.show_name}</em></p>
            <button id="return-btn">Return Item</button>
        `;
    } else if (status === 'borrowed') {
        statusSection = `
        <p><strong>Status:</strong> Borrowed by ${borrowInfo.requested_by} for <em>${borrowInfo.show_name}</em></p>
        <button id="return-borrow-btn">Return Item</button>
        `;
    } else {
        statusSection = `
            <p><strong>Status:</Strong> Available</p>
            <div style = "display:flex;gap:clamp(4px,1vw,8px);margin-top:8px;flex-wrap:wrap">
                <button id="checkout-btn">Check Out</button>
                <button id="borrow-btn">Ask to Borrow</button>
            </div>
        `;
    }

    document.getElementById("modal-details").innerHTML = `

        <h2>${item.item}</h2>
        <p><i>${item._type}</i><p>
        <img
            src="${getDriveImageUrl(item.image)}"
            style="max-width:80%"
        >
        <p><strong>Quantity:</strong> ${item.quantity}</p>
        ${fields}
        ${!activeGroup ? field("Group", GROUP_CONFIG[item._group]?.name) : ''}
        <hr>
        ${statusSection}
    `;

    document.getElementById('checkout-btn')?.addEventListener('click', async () => {
        const values = await showInputModal('Check Out Item', [
            { key: 'name', label: 'Your name' },
            { key: 'show', label: 'Show / production name' }
        ]);
        if (!values) return;

        showLoadingOverlay('Checking out item...');

        checkoutStatus[id] = {
            checked_out_by: values.name, 
            show_name: values.show,
            checkout_id: 'pending'
        };
        applyUserFilters();
        openModal(index, id);

        const result = await listCheckoutItems(
            id, item.item,
            item._group,
            item._type, values.name, values.show
        );

        hideLoadingOverlay();

        if (result.success) {
            checkoutStatus[id].checkout_id = result.checkout_id;
        } else {
            delete checkoutStatus[id];
            await loadCheckouts();
            applyUserFilters();
            openModal(index, id);
            alert('Checkout failed, please try again.');
        }
    });

    // borrow button
    document.getElementById('borrow-btn')?.addEventListener('click', async () => {
        const values = await showInputModal('Ask to Borrow', [
            { key: 'name', label: 'Your name' },
            { key: 'show', label: 'Show / production name' },
            { key: 'email', label: 'Your contact email' }
        ]);
        if (!values) return;
        openBorrowEmail([{ item: item, itemId: id }], values);
    });

    // return checkout button
    document.getElementById('return-btn')?.addEventListener('click', async () => {
        showLoadingOverlay('Returning item...');
        delete checkoutStatus[id];
        applyUserFilters();
        modal.style.display = "none";
        const result = await returnCheckout(id);
        hideLoadingOverlay();
        if (!result.success) {
            await loadCheckouts();
            applyUserFilters();
            alert('Return failed, please try again.')
        }
    });

    // return borrow button
    document.getElementById('return-borrow-btn')?.addEventListener('click', async () => {
        showLoadingOverlay('Returning item...');
        delete borrowStatus[id];
        applyUserFilters();
        modal.style.display = 'none';
        const result = await returnCheckout(id);
        hideLoadingOverlay();
        if (!result.success) {
            await loadCheckouts();
            applyUserFilters();
            alert('Return failed, please try again.');
        }
    });

    modal.style.display = "block";
}

function field(label, value) {
    return value ? `<p><strong>${label}:</strong> ${value}</p>`
    : "";
}

var modal = document.getElementById("item-modal");
modal.style.display = "none";
var closeButton = document.getElementById("close");


closeButton.addEventListener("click", () => { modal.style.display = "none";});
modal.addEventListener("click", (e) => {if (e.target === modal) modal.style.display = "none"; });
document.addEventListener("keydown", (e) => { if(e.key === "Escape") modal.style.display = "none"; }
);

// CHECKOUT + BORROW DATA
async function loadCheckouts() {
    try {
        const [checkouts, borrows] = await Promise.all([
            fetch(`${CHECKOUT_URL}?action=getCheckouts`).then(r => r.json()),
            fetch(`${CHECKOUT_URL}?action=getBorrowRequests`).then(r => r.json())
        ]);

        checkouts.forEach(c => {
            if (c.returned === 'false') {
                checkoutStatus[c.item_id] = {
                    checked_out_by: c.checked_out_by,
                    show_name: c.show_name,
                    checkout_id: c.checkout_id
                };
            }
        });

        borrows.forEach(b => {
            if (b.status === 'approved') {
                borrowStatus[b.item_id] = {
                    requested_by: b.requested_by,
                    show_name: b.show_name,
                    status: b.status,
                    request_id: b.request_id
                };
            }
        });
    } catch (err) {
        console.error("Failed to load checkouts:", err);
    }
}

function getItemStatus(itemId) {
    if (checkoutStatus[itemId]) return 'used';
    if (borrowStatus[itemId]?.status === 'approved') return 'borrowed';
    return 'available';
}

// CHECKOUT ACTIONS
async function listCheckoutItems(itemId, itemName, group, type, checkedOutBy, showName) {
    const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        body: JSON.stringify({
            action: 'checkout',
            item_id: itemId,
            item_name: itemName,
            group: group,
            type: type,
            checked_out_by: checkedOutBy,
            show_name: showName
        })
    });
    return res.json();
}

async function returnCheckout(itemId) {
    const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'return', item_id: itemId })
    });
    return res.json();
}

async function loadEmailConfig() {
    try {
        const res = await fetch (`${CHECKOUT_URL}?action=getConfig`);
        emailConfig = await res.json();
        console.log("emailConfig loaded:", emailConfig);
    } catch(err) {
        console.error("Failed to load email config:", err)
    }
}

function openBorrowEmail(itemList, userInfo = {}) {
    const groupsInvolved = [...new Set(itemList.map(({ item }) => item._group).filter(Boolean))];
    const recipients = groupsInvolved.flatMap(group => {
        const emails = emailConfig[group] || {};
        return [emails.groupEmail, emails.chairEmail].filter(e => e);
    });
    const uniqueRecipients = [...new Set(recipients)];

    const groupNames = groupsInvolved
        .map(g => GROUP_CONFIG[g]?.name)
        .filter(Boolean)
        .join(' & ');
    
    const itemLines = itemList.map(({ item }) => 
        `   - ${item.item} (${item._type})`
    ).join('\n');

    const subject = `Borrow Request - ${groupNames} Closet`;
    const body = 
`Hello,
    
I would like to request to borrow the following item(s) from the ${groupNames} closet for ${userInfo.show || '[YOUR SHOW]'}:
        
${itemLines}
    
Name: ${userInfo.name || '[YOUR NAME]'}
Contact Email: ${userInfo.email || '[YOUR EMAIL]'}
       
Please let me know if this is possible!
       
Thank you!`;

    itemList.forEach(({ item, itemId }) => {
        fetch(CHECKOUT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'borrowRequest',
                item_id: itemId,
                item_name: item.item,
                group: item._group,
                type: item._type,
                requested_by: userInfo.name || '',
                show_name: userInfo.show || '',
                contact_email: userInfo.email || ''
            })
        }).catch(err => console.error('Failed to log borrow request:', err));
    });

    const mailto = `mailto:${uniqueRecipients.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
}

// MULTI SELECT
function toggleSelectItem(itemId, card, btn) {
    if (selectedItems.has(itemId)) {
        selectedItems.delete(itemId);
        card.classList.remove('selected');
        if (btn) { btn.classList.remove('selected'); btn.textContent = ''; }
    } else {
        selectedItems.add(itemId);
        card.classList.add('selected');
        if (btn) { btn.classList.add('selected'); btn.textContent = '✓'; }
    }
    updateSelectionBar();
}

function updateSelectionBar() {
    let bar = document.getElementById('selection-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'selection-bar';
        document.body.appendChild(bar);
    }

    if (selectedItems.size > 0) {
        const selectedArray = [...selectedItems];
        const checkedOutCount = selectedArray.filter(id => checkoutStatus[id]).length;
        const availableCount = selectedArray.filter(id => !checkoutStatus[id] && !borrowStatus[id]).length;
        const allCheckedOut = checkedOutCount === selectedArray.length;
        const allAvailable = availableCount === selectedArray.length;

        bar.innerHTML = `
            <span id="selection-count">
                ${selectedItems.size} item${selectedItems.size > 1 ? 's' : ''} selected 
            </span>
            <div style="display:flex;gap:clamp(4px, 1vw, 8px;flex-wrap:wrap;justify-content:flex-end">
                ${!allCheckedOut ? `<button onclick="bulkCheckout()">Check Out${availableCount !== selectedArray.length ? ` (${availableCount})` : ''}</button>` : ''}
                ${!allCheckedOut ? `<button onclick="bulkBorrow()">Ask to Borrow${availableCount !== selectedArray.length ? `(${availableCount})` : ''}</button>` : ''}
                ${!allAvailable ? `<button onclick="bulkReturn()">Return${checkedOutCount !== selectedArray.length ? ` (${checkedOutCount})` : ''}</button>` : ''}
                <button onclick = "clearSelection()">Clear</button>
            </div>
        `;
        bar.style.display = 'flex';
    } else {
        bar.style.display = 'none';
    }
}

function clearSelection() {
    selectedItems.clear();
    document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.card-select-btn.selected').forEach(btn => {
        btn.classList.remove('selected');
        btn.textContent = '';
    });
    updateSelectionBar();
}

async function bulkCheckout() {
    const availableIds = [...selectedItems].filter(itemId => !checkoutStatus[itemId] && !borrowStatus[itemId]);
    if (availableIds.length === 0) return;

    const values = await showInputModal('Check Out Items', [
        { key: 'name', label: 'Your name' },
        { key: 'show', label: 'Show / production name' }
    ]);
    if (!values) return;

    showLoadingOverlay(`Checking out ${availableIds.length} item${availableIds.length > 1 ? 's' : ''}...`);

    for (const itemId of availableIds) {
        checkoutStatus[itemId] = {
            checked_out_by: values.name,
            show_name: values.show,
            checkout_id: 'pending'
        };
    }
    applyUserFilters();

    const failed = [];
    for (const itemId of availableIds) {
        const parts = itemId.split('-');
        const indexStr = parts[parts.length - 1];
        const item = groupData[parseInt(indexStr)];
        if (!item) continue;
        const result = await listCheckoutItems(
            itemId, item.item, item._group, item._type, values.name, values.show
        );
        if (result.success) {
            checkoutStatus[itemId].checkout_id = result.checkout_id;
        } else {
            failed.push(itemId);
            delete checkoutStatus[itemId];
        }
    }

    hideLoadingOverlay();
    clearSelection();
    applyUserFilters();

    if (failed.length > 0) {
        alert(`${failed.length} item(s) failed to check out. Please try again.`);
    }
}

async function bulkReturn() {
    const itemsToReturn = [...selectedItems].filter(itemId => checkoutStatus[itemId]);
    if (itemsToReturn.length === 0) return;

    showLoadingOverlay(`Returning ${itemsToReturn.length} items ${itemsToReturn.length > 1 ? 's' : ''}...`);

    for (const itemId of itemsToReturn) {
        delete checkoutStatus[itemId];
    }
    applyUserFilters();

    const failed = [];
    for (const itemId of itemsToReturn) {
        const result = await returnCheckout(itemId);
        if (!result.success) failed.push(itemId);
    }

    hideLoadingOverlay();
    clearSelection();
    applyUserFilters();

    if (failed.length > 0) {
        alert(`${failed.length} item(s) failed to return. Please try again.`);
    }
}

async function bulkBorrow() {
    if (selectedItems.size === 0) return;
    const availableIds = [...selectedItems].filter(id => !checkoutStatus[id]);
    const itemList = availableIds.map(itemId => {
        const parts = itemId.split('-');
        const indexStr = parts[parts.length - 1]; 
        const item = groupData[parseInt(indexStr)];
        return { item, itemId };
    }).filter(({ item }) => item && item._group);

    const values = await showInputModal('Ask to Borrow', [
        { key: 'name', label: 'Your name' },
        { key: 'show', label: 'Show/production name' },
        { key: 'email', label: 'Your contact email' }
    ]);
    if (!values) return;

    openBorrowEmail(itemList, values);
    clearSelection();
}

function showLoadingOverlay(message) {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div id="loading-box">
            <div class="spinner"></div>
            <p>${message}</p>
        </div>
    `;
    overlay.style.display = 'flex';
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

function showInputModal(title, fields) {
    return new Promise((resolve) => {
        const modal = document.getElementById('input-modal');
        const titleEl = document.getElementById('input-modal-title');
        const fieldsEl = document.getElementById('input-modal-fields');
        const confirmBtn = document.getElementById('input-modal-confirm');
        const cancelBtn = document.getElementById('input-modal-cancel');

        titleEl.textContent = title;
        fieldsEl.innerHTML = fields.map(f => `
            <input
                type="${f.type || 'text'}"
                id="input-field-${f.key}"
                placeholder="${f.label}"
                autocomplete="off"
            >
        `).join('');

        modal.style.display = 'flex';
        setTimeout(() => fieldsEl.querySelector('input')?.focus(), 100);

        function confirm() {
            const values = {};
            let valid = true;
            fields.forEach(f => {
                const inputEl = document.getElementById(`input-field-${f.key}`);
                const val = inputEl.value.trim();
                if (!val) { 
                    valid = false; 
                    input.style.borderColor = '#ef4444'; 
                    return; 
                }
                inputEl.style.borderColor = '#ddd';
                values[f.key] = val;
            });
            if (!valid) return;
            cleanup();
            resolve(values);
        }

        function cancel() {
            cleanup();
            resolve(null);
        }

        function cleanup() {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', confirm);
            cancelBtn.removeEventListener('click', cancel);
            document.removeEventListener('keydown', keyHandler);
        }

        function keyHandler(e) {
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') cancel();
        }

        confirmBtn.addEventListener('click', confirm);
        cancelBtn.addEventListener('click', cancel);
        document.addEventListener('keydown', keyHandler);
    });
}

loadInventory().then(() => {
    const initialSlug = new URLSearchParams(window.location.search).get('group');
    setGroup(GROUP_CONFIG[initialSlug] ? initialSlug : null);
});