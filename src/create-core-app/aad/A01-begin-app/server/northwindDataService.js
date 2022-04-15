import fetch from 'node-fetch';
import { join, dirname } from 'path';
import { Low, JSONFile } from 'lowdb';
import { fileURLToPath } from 'url';
import { NORTHWIND_ODATA_SERVICE, EMAIL_DOMAIN } from './constants.js';

const NORTHWIND_DB_DIRECTORY = "northwindDB"; // Directory where LowDB files are stored
const northwindDirectory = join(dirname(dirname(fileURLToPath(import.meta.url))), NORTHWIND_DB_DIRECTORY);

// NOTE: The Northwind database is stored in JSON files using a very simple database
// called lowdb. It does not handle multiple servers, locking, or any guarantee
// of integrity; it's just for development purposes!
// To download a fresh copy, type "npm run db-download" from the root of the project.
//
// Each Northwind database table is stored in its own JSON db so it doesn't all need
// to be written out when data changes. They are stored in memory here:
const tables = {};  // Store each lowDB object

async function getTable(tableName, primaryKey) {

    const tablesKey = tableName + "::" + primaryKey;
    if (!tables[tablesKey]) {

        // If here, there is no table in memory, so read it in now
        const file = join(northwindDirectory, `${tableName}.json`);
        const adapter = new JSONFile(file);
        const db = new Low(adapter);

        await db.read();
        db.data = db.data ?? {};

        // Store the lowdb and accessors for data and saving changes
        tables[tablesKey] = {
            tableName,
            db,
            primaryKey,
            get data() { return this.db.data[tableName]; },
            item: (value) => {
                const index = getIndex(tables[tablesKey], primaryKey);
                return index.lookup(value);
            },
            save: () => { this.write(); }
        }
    }

    return tables[tablesKey];
}

const indexes = {}; // Allow indexes for fast lookup, built on demand
function getIndex(table, columnName) {

    const indexName = `${table.tableName}::${columnName}`;

    if (!indexes[indexName]) {
        const index = {};
        for (let i in table.data) {
            index[table.data[i][columnName]] = i;
        }
        indexes[indexName] = {
            index,
            lookup: (key) => table.data[index[key]]
        }
    }

    return indexes[indexName];
}

export async function getEmployee(employeeId) {

    const employees = await getTable("Employees", "EmployeeID");
    const result = {};
    // const employeeProfile = employees.data.find((row) => row.EmployeeID == employeeId);
    const employeeProfile = employees.item(employeeId);

    result.id = employeeProfile.EmployeeID;
    result.displayName = `${employeeProfile.FirstName} ${employeeProfile.LastName}`;
    result.mail = `${employeeProfile.FirstName}@${EMAIL_DOMAIN}`;
    result.photo = employeeProfile.Photo.substring(104); // Trim Northwind-specific junk
    result.jobTitle = employeeProfile.Title;
    result.city = `${employeeProfile.City}, ${employeeProfile.Region || ''} ${employeeProfile.Country}`;

    const orders = await getTable("Orders", "OrderID");
    const customers = await getTable("Customers", "CustomerID");
    // const customerById = await getIndex("Customers", "CustomerID");
    
    const employeeOrders = orders.data.filter((order) => order.EmployeeID === result.id);

    result.orders = employeeOrders.map(order => ({
        orderId: order.OrderID,
        orderDate: order.OrderDate,
        customerId: order.CustomerID,
        customerName: customers.item(order.CustomerID).CompanyName, // customerById.lookup(order.CustomerID).CompanyName,
        customerContact: customers.item(order.CustomerID).ContactName,
        customerPhone: customers.item(order.CustomerID).Phone,
        shipName: order.ShipName,
        shipAddress: order.ShipAddress,
        shipCity: order.shipCity,
        shipRegion: order.ShipRegion,
        shipPostalCode: order.shipPostalCode,
        shipCountry: order.shipCountry
    }));
    return result;
}

const orderCache = {}
export async function getOrder(orderId) {

    if (orderCache[orderId]) return orderCache[orderId];

    const result = {};

    const response = await fetch(
        `${NORTHWIND_ODATA_SERVICE}/Orders(${orderId})?$expand=Customer,Employee`,
        {
            "method": "GET",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
    const order = await response.json();

    result.orderId = order.OrderID;
    result.orderDate = order.OrderDate;
    result.requiredDate = order.RequiredDate;
    result.customerName = order.Customer.CompanyName;
    result.contactName = order.Customer.ContactName;
    result.contactTitle = order.Customer.ContactTitle;
    result.customerAddress = order.Customer.Address;
    result.customerCity = order.Customer.City;
    result.customerRegion = order.Customer.Region || "";
    result.customerPostalCode = order.Customer.PostalCode;
    result.customerPhone = order.Customer.Phone;
    result.customerCountry = order.Customer.Country;
    result.employeeId = order.Employee.EmployeeID;
    result.employeeName = `${order.Employee.FirstName} ${order.Employee.LastName}`;
    result.employeeEmail = `${order.Employee.LastName.toLowerCase()}@northwindtraders.com`;
    result.employeeTitle = `${order.Employee.Title}`;

    const response2 = await fetch(
        `${NORTHWIND_ODATA_SERVICE}/Order_Details?$filter=OrderID eq ${orderId}&$top=10&$expand=Product,Product/Category,Product/Supplier`,
        {
            "method": "GET",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
    const details = await response2.json();

    result.details = details.value.map(lineItem => ({
        productId: lineItem.ProductID,
        productName: lineItem.Product.ProductName,
        categoryName: lineItem.Product.Category.CategoryName,
        categoryPicture: lineItem.Product.Category.Picture.substring(104), // Remove Northwind-specific junk
        quantity: lineItem.Quantity,
        unitPrice: lineItem.UnitPrice,
        discount: lineItem.Discount,
        supplierName: lineItem.Product.Supplier.CompanyName,
        supplierCountry: lineItem.Product.Supplier.Country
    }));

    orderCache[orderId] = result;
    return result;
}

const categoriesCache = {};
export async function getCategories() {

    if (categoriesCache.value) return categoriesCache.value;

    const response = await fetch(
        `${NORTHWIND_ODATA_SERVICE}/Categories?$select=CategoryID,CategoryName,Description,Picture`,
        {
            "method": "GET",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });

    const categories = await response.json();
    const result = categories.value.map(category => ({
        categoryId: category.CategoryID,
        displayName: category.CategoryName,
        description: category.Description,
        picture: category.Picture.substring(104), // Remove Northwind-specific junk
    }));
    categoriesCache.value = result;
    return result;
}

const categoryCache = {};
export async function getCategory(categoryId) {

    if (categoryCache[categoryId]) return categoryCache[categoryId];

    const result = {};

    const response = await fetch(
        `${NORTHWIND_ODATA_SERVICE}/Categories(${categoryId})?$select=CategoryID,CategoryName,Description,Picture`,
        {
            "method": "GET",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
    const category = await response.json();

    result.categoryId = category.CategoryID;
    result.displayName = category.CategoryName;
    result.description = category.Description;
    result.picture = category.Picture.substring(104); // Remove Northwind-specific junk

    const response2 = await fetch(
        `${NORTHWIND_ODATA_SERVICE}/Products?$filter=CategoryID eq ${categoryId}&$expand=Supplier`,
        {
            "method": "GET",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
    const details = await response2.json();

    result.products = details.value.map(product => ({
        productId: product.ProductID,
        productName: product.ProductName,
        quantityPerUnit: product.QuantityPerUnit,
        unitPrice: product.UnitPrice,
        unitsInStock: product.UnitsInStock,
        unitsOnOrder: product.UnitsOnOrder,
        reorderLevel: product.ReorderLevel,
        supplierName: product.Supplier.CompanyName,
        supplierCountry: product.Supplier.Country,
        discontinued: product.Discontinued
    })).sort((a, b) => a.productName.localeCompare(b.productName));

    categoryCache[categoryId] = result;
    return result;
}

const productCache = {};
export async function getProduct(productId) {

    if (productCache[productId]) return productCache[productId];

    const result = {};

    const response = await fetch(
        `${NORTHWIND_ODATA_SERVICE}/Products(${productId})?$expand=Category,Supplier`,
        {
            "method": "GET",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
    const product = await response.json();
    result.productId = product.ProductID;
    result.productName = product.ProductName;
    result.categoryId = product.CategoryID;
    result.categoryName = product.Category.CategoryName;
    result.quantityPerUnit = product.QuantityPerUnit;
    result.unitPrice = product.UnitPrice;
    result.unitsInStock = product.UnitsInStock;
    result.unitsOnOrder = product.UnitsOnOrder;
    result.reorderLevel = product.ReorderLevel;
    result.supplierName = product.Supplier.CompanyName;
    result.supplierCountry = product.Supplier.Country;
    result.discontinued = product.Discontinued;

    const response2 = await fetch(
        `${NORTHWIND_ODATA_SERVICE}/Order_Details?$filter=ProductID eq ${productId}&$expand=Order,Order/Customer,Order/Employee`,
        {
            "method": "GET",
            "headers": {
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
    const details = await response2.json();

    result.orders = details.value.map(orderDetail => ({
        orderId: orderDetail.OrderID,
        orderDate: orderDetail.Order.OrderDate,
        customerId: orderDetail.Order.Customer.CustomerID,
        customerName: orderDetail.Order.Customer.CompanyName,
        customerAddress: `${orderDetail.Order.Customer.Address}, ${orderDetail.Order.Customer.City} ${orderDetail.Order.Customer.Region || ""}, ${orderDetail.Order.Customer.Country}`,
        employeeId: orderDetail.Order.EmployeeID,
        employeeName: `${orderDetail.Order.Employee.FirstName} ${orderDetail.Order.Employee.LastName}`,
        quantity: orderDetail.Quantity,
        unitPrice: orderDetail.UnitPrice,
        discount: orderDetail.Discount,
    }));

    productCache[productId] = result;
    return result;
}
