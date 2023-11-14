const baseUrl = "https://8trx1me4c8.execute-api.us-east-1.amazonaws.com/Prod/ "; // TODO: This needs to be replaced
const form = document.getElementsByClassName('form-signin')[0];

console.log("hello")
const showAlert = (cssClass, message) => {
  const html = `
    <div class="alert alert-${cssClass} alert-dismissible" role="alert">
        <strong>${message}</strong>
        <button class="close" type="button" data-dismiss="alert" aria-label="Close">
            <span aria-hidden="true">×</span>
        </button>
    </div>`;

  document.querySelector('#alert').innerHTML += html;
};

const formToJSON = (elements) => [].reduce.call(elements, (data, element) => {
  data[element.name] = element.value;
  return data;
}, {});

const getUrlParameter = (name) => {
  name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
  const regex = new RegExp(`[\\?&]${name}=([^&#]*)`);
  const results = regex.exec(location.search);
  return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
};


const handleFormSubmit = (event) => {
  console.log(form)
  event.preventDefault();

  // const postUrl = `${baseUrl}subscriber`;
  // TODO: add condition later
  const regToken = getUrlParameter('x-amzn-marketplace-token');

  // Removed this check for testing. TODO: bring it back 
  // if (!regToken) {
  //   showAlert('danger',
  //     'Registration Token Missing. Please go to AWS Marketplace and follow the instructions to set up your account!');
  // } else {
  const data = formToJSON(form.elements);
  console.log("Data is ", data);
  if (!data["contactEmail"] || data["contactEmail"] === "" || validateEmail(email) === false) {
    console.log("WRONG EMAIl")
    const errorMessage = document.getElementById("errorMessage")
    errorMessage.style.display = "block"
  } else {
    errorMessage.style.display = "none"
  }
  data.regToken = regToken ? regToken : "IamAToken123";

  const xhr = new XMLHttpRequest();
  xhr.open('POST', postUrl, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify(data));

  xhr.onreadystatechange = () => {
    if (xhr.readyState == XMLHttpRequest.DONE) {
      showAlert('primary', xhr.responseText);
      console.log(JSON.stringify(xhr.responseText));
    }
  };
}
// };

const validateEmail = (email) => {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );
};

form.addEventListener('submit', handleFormSubmit);

const regToken = getUrlParameter('x-amzn-marketplace-token');
// TODO: comment it back
// if (!regToken) {
//   showAlert('danger', 'Registration Token Missing. Please go to AWS Marketplace and follow the instructions to set up your account!');
// }

if (!baseUrl) {
  showAlert('danger', 'Please update the baseUrl');
}
