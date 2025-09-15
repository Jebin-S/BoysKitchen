// ================================
// Firebase config (your project)
// ================================
const firebaseConfig = {
  apiKey: "AIzaSyCKyptCvZ4ABBEzmnwsjm8935AQgcitwg4",
  authDomain: "boy-s-kitchen.firebaseapp.com",
  projectId: "boy-s-kitchen",
  storageBucket: "boy-s-kitchen.firebasestorage.app",
  messagingSenderId: "68411183412",
  appId: "1:68411183412:web:ea48c512a78aab75275561",
  measurementId: "G-63RGCWHE2F"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// -------------------- helpers --------------------
const $ = id => document.getElementById(id);
function safe(v, fallback='') { return (v===undefined||v===null) ? fallback : v; }

// -------------------- Tabs --------------------
function openTab(evt, tabName) {
  document.querySelectorAll('.tablink').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tabcontent').forEach(c=>c.style.display='none');
  evt.currentTarget.classList.add('active');
  const el = document.getElementById(tabName);
  if(el) el.style.display = 'block';
}

// -------------------- Menu rendering --------------------
let menuCache = [];

function renderMenu() {
  const foodEl = $('menuFood'),
        drinksEl = $('menuDrinks'),
        dessertEl = $('menuDesserts');

  // Clear existing
  foodEl.innerHTML = '';
  drinksEl.innerHTML = '';
  dessertEl.innerHTML = '';

  db.collection('menu').orderBy('name').get().then(snap => {
    menuCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    menuCache.forEach(item => {
      const card = document.createElement('div');
      card.className = 'menu-card';
      const imgSrc = item.image && item.image.trim() ? item.image : '/images/no-image.png';
      card.innerHTML = `
        <img src="${imgSrc}" alt="${item.name}" onerror="this.src='/images/no-image.png'">
        <div class="info">
          <div class="name">${item.name}</div>
          <div class="meta">₹${item.price}</div>
        </div>
        <div class="controls">
          <input type="number" id="qty-${item.id}" min="0" value="0">
        </div>
      `;

      // Append to category container
      if (item.category.toLowerCase() === 'drink') drinksEl.appendChild(card);
      else if (item.category.toLowerCase() === 'dessert') dessertEl.appendChild(card);
      else foodEl.appendChild(card);

      // Attach qty input listener directly here
      const qtyEl = card.querySelector(`#qty-${item.id}`);
      if (qtyEl) qtyEl.addEventListener('input', updateOrderTotal);
    });

    updateOrderTotal();
    renderMenuMgmtList(); // refresh management list
  });
}
// -------------------- Order total & placing order --------------------
function updateOrderTotal() {
  let tot = 0;
  menuCache.forEach(d => {
    const qEl = document.getElementById(`qty-${d.id}`);
    if(qEl) {
      const q = parseInt(qEl.value) || 0;
      tot += q * (d.price || 0);
    }
  });
  $('orderTotal').textContent = tot;
}

$('placeOrderBtn').addEventListener('click', ()=>{
  const customer = ( $('customerName').value || 'Guest' ).trim();
  const items = [];
  let total = 0;
  menuCache.forEach(d => {
    const qEl = document.getElementById(`qty-${d.id}`);
    if(qEl) {
      const q = parseInt(qEl.value) || 0;
      if(q>0) {
        items.push({
          id: d.id,
          name: d.name,
          price: d.price,
          quantity: q,
          category: d.category || 'food',
          delivered: false
        });
        total += q * d.price;
        qEl.value = 0; // reset qty
      }
    }
  });

  if(items.length===0){ alert('Select at least one item'); return; }

  db.collection('orders').add({
    customer,
    items,
    total,
    status: 'pending',
    timestamp: Date.now()
  }).then(()=> {
    updateOrderTotal();
    alert('Order placed');
  }).catch(err=>{
    console.error(err);
    alert('Failed to place order');
  });
});

// -------------------- Menu management (save + preview) --------------------
const menuForm = $('menuForm');
if(menuForm){
  menuForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    const id = $('menuItemId').value;
    const data = {
      name: $('menuName').value.trim(),
      price: parseFloat($('menuPrice').value) || 0,
      category: $('menuCategory').value || 'food',
      stock: parseInt($('menuStock').value) || 0,
      image: '' // filename path if chosen
    };
    const f = $('menuImageFile').files && $('menuImageFile').files[0];
    if(f) data.image = '/images/' + f.name;

    if(id){
      db.collection('menu').doc(id).set(data).then(()=>{ renderMenu(); menuForm.reset(); $('imagePreview').innerHTML=''; });
    } else {
      db.collection('menu').add(data).then(()=>{ renderMenu(); menuForm.reset(); $('imagePreview').innerHTML=''; });
    }
  });

  // preview image
  $('menuImageFile').addEventListener('change', ()=>{
    const f = $('menuImageFile').files && $('menuImageFile').files[0];
    const preview = $('imagePreview'); preview.innerHTML = '';
    if(f){
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.style.maxWidth='140px';
      img.style.maxHeight='90px';
      preview.appendChild(img);
    }
  });
}

function renderMenuMgmtList(){
  const ul = $('menuMgmtList'); ul.innerHTML = '';
  menuCache.forEach(m=>{
    const li = document.createElement('li');
    li.textContent = `${m.name} - ₹${m.price} • ${m.category}`;
    ul.appendChild(li);
  });
}

// -------------------- Render Kitchen, Delivery, All Orders --------------------
function renderOrdersView(snapshotDocs){
  // snapshotDocs: array of {id, ...data} - we will use latest snapshot from listener
  const kitchenFoodEl = $('kitchenFood'); kitchenFoodEl.innerHTML = '';
  const kitchenDrinksEl = $('kitchenDrinks'); kitchenDrinksEl.innerHTML = '';
  const deliveryFoodEl = $('deliveryFoodList'); deliveryFoodEl.innerHTML = '';
  const deliveryDrinkEl = $('deliveryDrinkList'); deliveryDrinkEl.innerHTML = '';
  const allOrdersEl = $('allOrdersList'); allOrdersEl.innerHTML = '';

  const totalsFood = {};
  const totalsDrink = {};

  snapshotDocs.forEach(order => {
    const deliveredItems = []; // not using deliveredItems array model here; items have delivered boolean
    (order.items || []).forEach((it, idx)=>{
      // skip canceled items: in this model canceled items are removed from array already
      const isDelivered = !!it.delivered;
      const remainingQty = it.quantity; // delivered is full-flag; quantity treated as a block

      // Kitchen totals (pending only)
      if(!isDelivered){
        if((it.category||'').toLowerCase() === 'drink' || (it.category||'').toLowerCase() === 'dessert'){
          totalsDrink[it.name] = (totalsDrink[it.name]||0) + remainingQty;
        } else {
          totalsFood[it.name] = (totalsFood[it.name]||0) + remainingQty;
        }
      }

      // Delivery queue (pending only)
      if(!isDelivered){
        const block = document.createElement('div');
        block.className = 'delivery-item';
        const left = document.createElement('div'); left.className = 'left';
        left.innerHTML = `<strong>${safe(order.customer,'Guest')}</strong><div style="color:#444">${safe(it.name)} • x${it.quantity}</div>`;
        const btns = document.createElement('div');

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delivered';
        delBtn.onclick = ()=> markItemDelivered(order.id, idx);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'cancel';
        cancelBtn.onclick = ()=> cancelLineItem(order.id, idx);

        btns.appendChild(delBtn); btns.appendChild(cancelBtn);
        block.appendChild(left); block.appendChild(btns);

        if((it.category||'').toLowerCase() === 'drink' || (it.category||'').toLowerCase() === 'dessert'){
          deliveryDrinkEl.appendChild(block);
        } else {
          deliveryFoodEl.appendChild(block);
        }
      }

      // All Orders view (every item line)
      // group per order card
      let card = allOrdersEl.querySelector(`[data-order="${order.id}"]`);
      if(!card){
        card = document.createElement('div'); card.className='orderCard'; card.dataset.order = order.id;
        const h = document.createElement('h3'); h.textContent = safe(order.customer,'Guest'); card.appendChild(h);
        allOrdersEl.appendChild(card);
      }
      const p = document.createElement('p');
      const statusText = isDelivered ? 'Delivered' : 'Pending';
      p.innerHTML = `<span>${safe(it.name)} (x${it.quantity}) • ₹${it.price}</span><span style="font-weight:700">${statusText}</span>`;
      const btnGrp = document.createElement('span');
      btnGrp.style.marginLeft='10px';
      btnGrp.style.display='inline-flex';
      btnGrp.style.gap='6px';

      if(!isDelivered){
        const markBtn = document.createElement('button'); markBtn.textContent = 'Mark Delivered';
        markBtn.onclick = ()=> markItemDelivered(order.id, idx);
        btnGrp.appendChild(markBtn);

        const cancelBtn2 = document.createElement('button'); cancelBtn2.textContent = 'Cancel';
        cancelBtn2.className='cancel'; cancelBtn2.onclick = ()=> cancelLineItem(order.id, idx);
        btnGrp.appendChild(cancelBtn2);
      } else {
        const undoBtn = document.createElement('button'); undoBtn.textContent = 'Mark Pending';
        undoBtn.onclick = ()=> markItemPending(order.id, idx);
        btnGrp.appendChild(undoBtn);
      }
      p.appendChild(btnGrp);
      card.appendChild(p);
    });
  });

  // render kitchen totals
  Object.entries(totalsFood).forEach(([name, qty])=>{
    const div = document.createElement('div'); div.className='row'; div.textContent = `${name}: ${qty}`; kitchenFoodEl.appendChild(div);
  });
  Object.entries(totalsDrink).forEach(([name, qty])=>{
    const div = document.createElement('div'); div.className='row'; div.textContent = `${name}: ${qty}`; kitchenDrinksEl.appendChild(div);
  });
}

// -------------------- Firestore listeners --------------------
db.collection('orders').orderBy('timestamp','asc').onSnapshot(snap=>{
  const docs = snap.docs.map(d=>({ id: d.id, ...d.data() }));
  renderOrdersView(docs);
});

db.collection('menu').orderBy('name').onSnapshot(()=> {
  // re-render menu UI (non-blocking)
  renderMenu();
});

// -------------------- Item actions --------------------
function markItemDelivered(orderId, itemIndex){
  const ref = db.collection('orders').doc(orderId);
  ref.get().then(d=>{
    if(!d.exists) return;
    const order = d.data();
    if(!order.items || !order.items[itemIndex]) return;

    order.items[itemIndex].delivered = true;
    // compute if all delivered
    const allDelivered = order.items.every(it=>it.delivered === true);
    const updateData = { items: order.items, status: allDelivered ? 'delivered' : 'pending' };
    return ref.update(updateData);
  }).catch(e=>console.error(e));
}

function markItemPending(orderId, itemIndex){
  const ref = db.collection('orders').doc(orderId);
  ref.get().then(d=>{
    if(!d.exists) return;
    const order = d.data();
    if(!order.items || !order.items[itemIndex]) return;

    order.items[itemIndex].delivered = false;
    const allDelivered = order.items.every(it=>it.delivered === true);
    const updateData = { items: order.items, status: allDelivered ? 'delivered' : 'pending' };
    return ref.update(updateData);
  }).catch(e=>console.error(e));
}

function cancelLineItem(orderId, itemIndex){
  const ref = db.collection('orders').doc(orderId);
  ref.get().then(d=>{
    if(!d.exists) return;
    const order = d.data();
    if(!order.items || !order.items[itemIndex]) return;

    // remove the single item at itemIndex
    order.items.splice(itemIndex, 1);

    if(order.items.length === 0){
      // delete the whole order if no items left
      return ref.delete();
    } else {
      // otherwise update items & status
      const allDelivered = order.items.every(it=>it.delivered === true);
      return ref.update({ items: order.items, status: allDelivered ? 'delivered' : 'pending' });
    }
  }).catch(e=>console.error(e));
}

// -------------------- Export to Excel --------------------
$('exportExcel').addEventListener('click', ()=>{
  db.collection('orders').orderBy('timestamp','asc').get().then(snap=>{
    const rows = [];
    snap.forEach(doc=>{
      const order = doc.data();
      (order.items || []).forEach(it=>{
        rows.push({
          Customer: order.customer,
          Item: it.name,
          Price: it.price,
          Quantity: it.quantity,
          Delivered: it.delivered ? 'Yes' : 'No',
          Status: order.status || 'pending',
          Time: new Date(order.timestamp || Date.now()).toLocaleString()
        });
      });
    });

    if(rows.length===0){
      alert('No orders to export');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    XLSX.writeFile(wb, 'orders.xlsx');
  }).catch(e=>console.error(e));
});
