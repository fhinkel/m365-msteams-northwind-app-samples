import {
    getLoggedInEmployee,
    logoff
} from './identityService.js';

class northwindUserPanel extends HTMLElement {

    async connectedCallback() {

        const employee = await getLoggedInEmployee();

        if (!employee) {

            // If here, nobody is logged in - redirect to the login page
            window.location.href = "/northwindIdentity/login.html";

        } else {

            this.innerHTML = `<div class="userPanel">
                <img src="data:image/bmp;base64,${employee.photo}"></img>
                <p>${employee.displayName}</p>
                <p>${employee.jobTitle}</p>
                <hr />
                <button id="logout">Log out</button>
            </div>
            `;

        }

        const logoutButton = document.getElementById('logout');
        logoutButton.addEventListener('click', async ev => {
            logoff();
            window.location.href = "/northwindIdentity/login.html";
        });
        
    }
}

// Define the web component and insert an instance at the top of the page
customElements.define('northwind-user-panel', northwindUserPanel);
const panel = document.createElement('northwind-user-panel');
document.body.insertBefore(panel, document.body.firstChild);
