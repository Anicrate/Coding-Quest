let p = fetch('https://kontests.net/api/v1/all')

p.then((value) => {
    return value.json()
}).then((value)=> {
    data =""
    for (item in value){
        const startdate = new Date(value[item].start_time)
        const enddate = new Date(value[item].end_time)
        data+=`<div class="card">
                    <h4>Website : ${value[item].site.toUpperCase()}</h4>
                    <h5 class="card-title">${value[item].name}</h5>
                    <p>Starts at:${startdate} </p>
                    <p>Ends at: ${enddate}</p>
                    <a href="${value[item].url}" class="btn btn-primary btn-pink">Visit here</a>
            </div>`
        contest.innerHTML = data
    }
})
function myFunction() {
    var input,search
    input = document.getElementById('myInput');
    search = input.value.toUpperCase();

    var card, arr
    card = document.getElementById("contest");
    arr = card.getElementsByClassName('card');
    
    var text, i, textValue
    for (i = 0; i < arr.length; i++) {
    text = arr[i].getElementsByTagName("h4")[0];
    textValue = text.textContent || text.innerText;
    if (textValue.toUpperCase().indexOf(search) > -1) {
      arr[i].style.display = "";
    } else {
      arr[i].style.display = "none";
    }
  }
}


