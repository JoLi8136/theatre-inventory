const CHECKOUT_URL = 'https://script.google.com/macros/s/AKfycbz4peIvc7HqVMzYHcRJE0CUjeUHRSIBnSLN2TC9RGjGZ4tn21aTKJXOsbPi9zStEPqA/exec';

let allRequests = [];
let currentFilter = 'pending';

// Read group from URL — restricts view to that group's requests
const urlParams = new URLSearchParams(window.location.search);
const adminGroup = urlParams.get('group') || null;

const GROUP_NAMES = {
    ensemble: 'Ensemble',
    musicalforum: 'Musical Forum',
    btc: 'BTC'
};

async function loadRequests() {
    try {
        const res = await fetch(`${CHECKOUT_URL}?action=getBorrowRequests`);
        allRequests = await res.json();

        // Filter by group if specified in URL
        if (adminGroup) {
            allRequests = allRequests.filter(r => r.group === adminGroup);
            document.getElementById('admin-group-label').textContent =
                `${GROUP_NAMES[adminGroup] || adminGroup} Requests`;
        } else {
            document.getElementById('admin-group-label').textContent = 'All Borrow Requests';
        }

        document.getElementById('loading-admin').style.display = 'none';
        renderRequests();
    } catch (err) {
        document.getElementById('loading-admin').textContent = 'Failed to load requests.';
        console.error(err);
    }
}

function filterRequests(filter) {
    currentFilter = filter;
    document.querySelectorAll('#filter-btns button').forEach(b => b.classList.remove('active'));
    document.getElementById(`f-${filter}`).classList.add('active');
    renderRequests();
}

function renderRequests() {
    const container = document.getElementById('admin-container');
    const filtered = currentFilter === 'all'
        ? allRequests
        : allRequests.filter(r => r.status === currentFilter);

    if (filtered.length === 0) {
        container.innerHTML = `<p style="color:#9ca3af;padding:32px 0">No ${currentFilter} requests.</p>`;
        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Item</th>
                    <th>Group</th>
                    <th>Requested By</th>
                    <th>Show</th>
                    <th>Contact</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(r => `
                    <tr id="row-${r.request_id}">
                        <td>${r.item_name || ''}</td>
                        <td>${r.group || ''}</td>
                        <td>${r.requested_by || ''}</td>
                        <td>${r.show_name || ''}</td>
                        <td><a href="mailto:${r.contact_email}">${r.contact_email || ''}</a></td>
                        <td>${r.requested_date || ''}</td>
                        <td>
                            <span class="badge badge-${r.status}">${r.status}</span>
                        </td>
                        <td>
                            ${r.status === 'pending' ? `
                                <button class="btn-approve" onclick="openReplyModal('${r.request_id}', 'approved')">✅ Approve</button>
                                <button class="btn-deny" onclick="openReplyModal('${r.request_id}', 'denied')" style="margin-left:4px">❌ Deny</button>
                            ` : '—'}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// ── Reply modal ──
function openReplyModal(requestId, status) {
    const req = allRequests.find(r => r.request_id === requestId);
    if (!req) return;

    const modal = document.getElementById('reply-modal');
    const title = document.getElementById('reply-modal-title');
    const preview = document.getElementById('reply-preview');
    const noteField = document.getElementById('reply-note');

    title.textContent = status === 'approved'
        ? `✅ Approve — ${req.item_name}`
        : `❌ Deny — ${req.item_name}`;

    // Pre-fill the note
    noteField.value = '';

    // Show email preview
    preview.innerHTML = `
        <p style="margin:0 0 4px"><strong>To:</strong> ${req.contact_email}</p>
        <p style="margin:0 0 4px"><strong>Subject:</strong> [${status === 'approved' ? 'Approved' : 'Denied'}] Borrow Request — ${req.item_name}</p>
        <p style="margin:0;color:#6b7280;font-size:0.85rem">A reply email will open in your email client pre-filled with the decision and your note.</p>
    `;

    modal.style.display = 'flex';

    // Store pending action
    modal.dataset.requestId = requestId;
    modal.dataset.status = status;
}

function closeReplyModal() {
    document.getElementById('reply-modal').style.display = 'none';
}

async function confirmReply() {
    const modal = document.getElementById('reply-modal');
    const requestId = modal.dataset.requestId;
    const status = modal.dataset.status;
    const note = document.getElementById('reply-note').value.trim();

    const req = allRequests.find(r => r.request_id === requestId);
    if (!req) return;

    // Update the sheet
    try {
        await fetch(`${CHECKOUT_URL}?action=${status === 'approved' ? 'approve' : 'deny'}&request_id=${requestId}`);
        const r = allRequests.find(r => r.request_id === requestId);
        if (r) r.status = status;
        showStatus(`Request ${status} successfully.`, 'success');
        renderRequests();
    } catch (err) {
        showStatus('Failed to update. Please try again.', 'error');
        return;
    }

    closeReplyModal();

    // Open reply email
    const groupName = GROUP_NAMES[req.group] || req.group;
    const subject = `[${status === 'approved' ? 'Approved ✅' : 'Denied ❌'}] Borrow Request — ${req.item_name}`;
    const body = status === 'approved'
        ? `Hi ${req.requested_by},

Your request to borrow ${req.item_name} from the ${groupName} closet for ${req.show_name} has been approved! 🎉

${note ? `Note from the equipment chair:\n${note}\n` : ''}
Please let us know if you need help picking up the items from the cage and make sure to return the item when your show is done.

Best,
${groupName} Equipment Chair`
        : `Hi ${req.requested_by},

Unfortunately your request to borrow ${req.item_name} from the ${groupName} closet for ${req.show_name} has been denied.

${note ? `Reason:\n${note}\n` : ''}
Feel free to reach out if you have any questions.

Best,
${groupName} Equipment Chair`;

    const mailto = `mailto:${req.contact_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
}

function showStatus(msg, type) {
    const el = document.getElementById('status-msg');
    el.textContent = msg;
    el.className = type;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

loadRequests();